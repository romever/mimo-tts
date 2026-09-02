import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { openDatabase, readApiSettings, resolveDatabasePath, writeApiSettings } from './database.mjs';
import {
  createVoice,
  deleteVoice,
  getVoice,
  listVoices,
  readFavoriteVoiceIds,
  readVoiceSample,
  updateVoice,
  VoiceStoreError,
  writeFavoriteVoice,
} from './voiceStore.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_VOICE_BODY_BYTES = 16 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function resolvePort() {
  const configuredPort = process.env.MIMO_TTS_API_PORT?.trim();
  const port = Number(configuredPort || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MIMO_TTS_API_PORT 必须是 1 到 65535 之间的整数');
  }
  return port;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES, tooLargeMessage = '请求体不能超过 64 KB') {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, '请求必须使用 application/json');
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new HttpError(413, tooLargeMessage);
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    throw new HttpError(400, '请求体不能为空');
  }

  const body = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, '请求体不是有效的 JSON');
  }
}

function validateApiSettings(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'API 配置必须是对象');
  }
  if (typeof payload.endpoint !== 'string' || typeof payload.apiKey !== 'string') {
    throw new HttpError(400, 'API 配置必须包含字符串类型的 endpoint 和 apiKey');
  }

  const endpoint = payload.endpoint.trim();
  const apiKey = payload.apiKey.trim();
  if (!endpoint) {
    throw new HttpError(400, 'API Base URL 不能为空');
  }

  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new HttpError(400, 'API Base URL 必须是有效的 URL');
  }
  if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) {
    throw new HttpError(400, 'API Base URL 只支持 HTTP 或 HTTPS');
  }

  return { endpoint, apiKey };
}

function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, '请求路径中的音色 ID 无效');
  }
}

function validateFavoritePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.favorite !== 'boolean') {
    throw new HttpError(400, 'favorite 必须是布尔值');
  }
  return payload.favorite;
}

function sendAudio(response, sample) {
  const safeFileName = sample.fileName.replace(/[\\\r\n"/]/g, '_');
  const asciiFileName = safeFileName.replace(/[^\x20-\x7e]/g, '_');
  const encodedFileName = encodeURIComponent(safeFileName).replace(/[!'()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': sample.mimeType,
    'Content-Length': sample.bytes.length,
    // 兼容文件名只支持 ASCII 的客户端，完整文件名通过 RFC 5987 编码传递。
    'Content-Disposition': 'inline; filename="' + asciiFileName + '"; filename*=UTF-8\'\'' + encodedFileName,
  });
  response.end(sample.bytes);
}

const port = resolvePort();
const databasePath = resolveDatabasePath();
const database = await openDatabase(databasePath);
const voiceStorageDirectory = path.resolve(path.dirname(databasePath), 'voices');

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://' + HOST);
  const handleRequest = async () => {
    if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === '/api/settings' && request.method === 'GET') {
      sendJson(response, 200, readApiSettings(database));
      return;
    }

    if (requestUrl.pathname === '/api/settings' && request.method === 'PUT') {
      const settings = validateApiSettings(await readJsonBody(request));
      writeApiSettings(database, settings);
      console.log('已保存本地 API 配置（Key 摘要：' + hashApiKey(settings.apiKey) + '）');
      sendJson(response, 200, settings);
      return;
    }

    if (requestUrl.pathname === '/api/voices' && request.method === 'GET') {
      sendJson(response, 200, {
        voices: await listVoices(database, voiceStorageDirectory),
        favoriteIds: readFavoriteVoiceIds(database),
      });
      return;
    }

    if (requestUrl.pathname === '/api/voices' && request.method === 'POST') {
      const voice = await createVoice(database, voiceStorageDirectory, await readJsonBody(request, MAX_VOICE_BODY_BYTES, '音色请求体不能超过 16 MB'));
      console.log('已创建本地音色（ID：' + voice.id + '，类型：' + voice.kind + '）');
      sendJson(response, 201, voice);
      return;
    }

    const voiceSampleMatch = /^\/api\/voices\/([^/]+)\/sample$/.exec(requestUrl.pathname);
    if (voiceSampleMatch && request.method === 'GET') {
      const sample = await readVoiceSample(database, voiceStorageDirectory, decodePathSegment(voiceSampleMatch[1]));
      sendAudio(response, sample);
      return;
    }

    const voiceMatch = /^\/api\/voices\/([^/]+)$/.exec(requestUrl.pathname);
    if (voiceMatch) {
      const voiceId = decodePathSegment(voiceMatch[1]);
      if (request.method === 'GET') {
        sendJson(response, 200, await getVoice(database, voiceStorageDirectory, voiceId));
        return;
      }
      if (request.method === 'PATCH') {
        const voice = await updateVoice(database, voiceStorageDirectory, voiceId, await readJsonBody(request, MAX_VOICE_BODY_BYTES, '音色请求体不能超过 16 MB'));
        console.log('已更新本地音色（ID：' + voice.id + '）');
        sendJson(response, 200, voice);
        return;
      }
      if (request.method === 'DELETE') {
        await deleteVoice(database, voiceStorageDirectory, voiceId);
        console.log('已删除本地音色（ID：' + voiceId + '）');
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
    }

    if (requestUrl.pathname === '/api/voice-preferences' && request.method === 'GET') {
      sendJson(response, 200, { favoriteIds: readFavoriteVoiceIds(database) });
      return;
    }

    const preferenceMatch = /^\/api\/voice-preferences\/([^/]+)$/.exec(requestUrl.pathname);
    if (preferenceMatch && request.method === 'PUT') {
      const voiceId = decodePathSegment(preferenceMatch[1]);
      const favorite = validateFavoritePayload(await readJsonBody(request));
      writeFavoriteVoice(database, voiceId, favorite);
      sendJson(response, 200, { voiceId, favorite });
      return;
    }

    throw new HttpError(404, '未找到请求的本地接口');
  };

  handleRequest().catch((error) => {
    if (error instanceof HttpError || error instanceof VoiceStoreError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error('本地配置服务请求失败:', error);
    sendJson(response, 500, { error: '本地配置服务内部错误' });
  });
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

server.on('error', (error) => {
  console.error('本地配置服务启动失败:', error.message);
  database.close();
  process.exitCode = 1;
});

server.listen(port, HOST, () => {
  console.log('MiMo TTS 本地配置服务已启动：http://' + HOST + ':' + port);
  console.log('SQLite 数据库：' + databasePath);
});
