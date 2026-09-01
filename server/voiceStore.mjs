import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const VOICE_KINDS = new Set(['design', 'clone']);
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 600;
const MAX_PREVIEW_TEXT_LENGTH = 500;
const MAX_CLONE_BASE64_BYTES = 10 * 1024 * 1024;
const SAMPLE_MIME_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

export class VoiceStoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function initializeVoiceTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS voices (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('design', 'clone')),
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      voice_description TEXT,
      preview_text TEXT,
      sample_file TEXT,
      sample_mime_type TEXT,
      sample_file_name TEXT,
      sample_size INTEGER,
      source_voice_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (kind = 'design' AND voice_description IS NOT NULL AND sample_file IS NULL)
        OR
        (kind = 'clone' AND voice_description IS NULL AND sample_file IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS voice_preferences (
      voice_id TEXT PRIMARY KEY,
      favorite INTEGER NOT NULL CHECK(favorite IN (0, 1)),
      updated_at TEXT NOT NULL
    );
  `);

  const columns = database.prepare('PRAGMA table_info(voices)').all();
  if (!columns.some((column) => column.name === 'preview_text')) {
    database.exec('ALTER TABLE voices ADD COLUMN preview_text TEXT');
  }
  if (!columns.some((column) => column.name === 'source_voice_id')) {
    database.exec('ALTER TABLE voices ADD COLUMN source_voice_id TEXT');
  }
}

function assertObject(payload, message) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new VoiceStoreError(400, message);
  }
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new VoiceStoreError(400, '音色名称不能为空');
  }
  const normalized = name.trim();
  if (normalized.length > MAX_NAME_LENGTH) {
    throw new VoiceStoreError(400, '音色名称不能超过 80 个字符');
  }
  return normalized;
}

function validateDescription(description) {
  if (typeof description !== 'string' || !description.trim()) {
    throw new VoiceStoreError(400, '设计音色需要填写音色描述');
  }
  const normalized = description.trim();
  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    throw new VoiceStoreError(400, '音色描述不能超过 600 个字符');
  }
  return normalized;
}

function validatePreviewText(previewText) {
  if (previewText === undefined || previewText === null) return null;
  if (typeof previewText !== 'string') {
    throw new VoiceStoreError(400, '试听文本必须是字符串');
  }
  const normalized = previewText.trim();
  if (normalized.length > MAX_PREVIEW_TEXT_LENGTH) {
    throw new VoiceStoreError(400, '试听文本不能超过 500 个字符');
  }
  return normalized || null;
}

function validateBase64(base64) {
  if (typeof base64 !== 'string' || !base64 || base64.length > MAX_CLONE_BASE64_BYTES) {
    throw new VoiceStoreError(413, '复刻样本的 Base64 编码不能超过 10 MB');
  }
  if (base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new VoiceStoreError(400, '复刻样本不是有效的 Base64 音频数据');
  }
  return Buffer.from(base64, 'base64');
}

function hasBytes(bytes, signature, offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function isMpegAudio(bytes) {
  if (hasBytes(bytes, [0x49, 0x44, 0x33])) {
    return true;
  }
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0;
}

function validateSampleSignature(bytes, mimeType) {
  const isWav = bytes.length >= 12 && hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, [0x57, 0x41, 0x56, 0x45], 8);
  const isMpeg = isMpegAudio(bytes);
  if ((mimeType === 'audio/wav' || mimeType === 'audio/x-wav') && !isWav) {
    throw new VoiceStoreError(400, 'WAV 样本内容与文件类型不匹配');
  }
  if ((mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') && !isMpeg) {
    throw new VoiceStoreError(400, 'MP3 样本内容与文件类型不匹配');
  }
}

export function parseSampleDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new VoiceStoreError(400, '复刻音色需要上传 MP3 或 WAV 样本');
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match || !Object.hasOwn(SAMPLE_MIME_TYPES, match[1])) {
    throw new VoiceStoreError(400, '复刻音色只支持 MP3 和 WAV 样本');
  }
  const mimeType = match[1];
  const bytes = validateBase64(match[2]);
  if (!bytes.length) {
    throw new VoiceStoreError(400, '复刻样本不能为空');
  }
  validateSampleSignature(bytes, mimeType);
  return {
    bytes,
    mimeType,
    extension: SAMPLE_MIME_TYPES[mimeType],
  };
}

function rowToVoice(row, sampleAvailable = true) {
  const sample = row.kind === 'clone'
    ? {
        mimeType: row.sample_mime_type,
        fileName: row.sample_file_name,
        size: row.sample_size,
        available: sampleAvailable,
      }
    : null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    voiceDescription: row.voice_description,
    previewText: row.preview_text ?? null,
    sourceVoiceId: row.source_voice_id ?? null,
    sample,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readVoiceRow(database, id) {
  const row = database.prepare('SELECT * FROM voices WHERE id = ?').get(id);
  if (!row) {
    throw new VoiceStoreError(404, '未找到指定的自建音色');
  }
  return row;
}

function assertNameAvailable(database, name, excludedId = null) {
  const row = database.prepare('SELECT id FROM voices WHERE name = ? COLLATE NOCASE').get(name);
  if (row && row.id !== excludedId) {
    throw new VoiceStoreError(409, '已经存在同名自建音色，请换一个名称');
  }
}

function validateSourceVoiceId(sourceVoiceId) {
  if (sourceVoiceId === undefined || sourceVoiceId === null) return null;
  if (typeof sourceVoiceId !== 'string' || !sourceVoiceId.trim()) {
    throw new VoiceStoreError(400, '固化来源音色 ID 无效');
  }
  return sourceVoiceId.trim();
}

function assertDesignSource(database, sourceVoiceId) {
  if (!sourceVoiceId) return null;
  const source = database.prepare('SELECT id, kind FROM voices WHERE id = ?').get(sourceVoiceId);
  if (!source) {
    throw new VoiceStoreError(400, '固化来源音色不存在');
  }
  if (source.kind !== 'design') {
    throw new VoiceStoreError(400, '固化来源必须是设计音色');
  }
  return source.id;
}

function normalizeSampleFileName(fileName, fallback) {
  if (typeof fileName !== 'string') return fallback;
  const normalized = fileName.trim().replace(/[\\/\r\n"]/g, '_').slice(0, 160);
  return normalized || fallback;
}

function resolveSamplePath(storageDirectory, sampleFile) {
  if (typeof sampleFile !== 'string' || !sampleFile) {
    throw new VoiceStoreError(500, '音色样本路径无效');
  }
  const storagePath = path.resolve(storageDirectory);
  const samplePath = path.resolve(storagePath, sampleFile);
  if (path.dirname(samplePath) !== storagePath || path.basename(samplePath) !== sampleFile) {
    throw new VoiceStoreError(500, '音色样本路径无效');
  }
  return samplePath;
}

async function sampleAvailable(storageDirectory, row) {
  if (row.kind !== 'clone') return true;
  let samplePath;
  try {
    samplePath = resolveSamplePath(storageDirectory, row.sample_file);
    const sampleStat = await lstat(samplePath);
    if (!sampleStat.isFile() || sampleStat.size !== row.sample_size) return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  let bytes;
  try {
    bytes = await readFile(samplePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  try {
    validateSampleSignature(bytes, row.sample_mime_type);
  } catch (error) {
    if (error instanceof VoiceStoreError) return false;
    throw error;
  }
  return true;
}

export async function listVoices(database, storageDirectory) {
  const rows = database.prepare('SELECT * FROM voices ORDER BY updated_at DESC, created_at DESC').all();
  return Promise.all(rows.map(async (row) => rowToVoice(row, await sampleAvailable(storageDirectory, row))));
}

export async function getVoice(database, storageDirectory, id) {
  const row = readVoiceRow(database, id);
  return rowToVoice(row, await sampleAvailable(storageDirectory, row));
}

async function writeSample(storageDirectory, id, sample) {
  await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
  const sampleFile = id + '.' + sample.extension;
  const finalPath = path.join(storageDirectory, sampleFile);
  const tempPath = path.join(storageDirectory, '.' + id + '.' + randomUUID() + '.tmp');
  await writeFile(tempPath, sample.bytes, { mode: 0o600 });
  try {
    await rename(tempPath, finalPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
  return { sampleFile, finalPath };
}

async function removeSample(storageDirectory, sampleFile) {
  if (!sampleFile) return;
  const samplePath = resolveSamplePath(storageDirectory, sampleFile);
  try {
    await unlink(samplePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function buildCreatePayload(payload) {
  assertObject(payload, '音色数据必须是对象');
  if (!VOICE_KINDS.has(payload.kind)) {
    throw new VoiceStoreError(400, '只支持设计音色和音色复刻');
  }
  const name = validateName(payload.name);
  if (payload.kind === 'design') {
    if (payload.sampleDataUrl !== undefined || payload.sourceVoiceId !== undefined) {
      throw new VoiceStoreError(400, '设计音色不能包含复刻样本或固化来源');
    }
    return {
      kind: payload.kind,
      name,
      voiceDescription: validateDescription(payload.voiceDescription),
      previewText: validatePreviewText(payload.previewText),
      sourceVoiceId: null,
    };
  }
  if (payload.voiceDescription !== undefined || payload.previewText !== undefined) {
    throw new VoiceStoreError(400, '音色复刻不能包含设计描述或试听文本');
  }
  return {
    kind: payload.kind,
    name,
    previewText: null,
    sample: parseSampleDataUrl(payload.sampleDataUrl),
    sampleFileName: payload.sampleFileName,
    sourceVoiceId: validateSourceVoiceId(payload.sourceVoiceId),
  };
}

export async function createVoice(database, storageDirectory, payload) {
  const normalized = buildCreatePayload(payload);
  assertNameAvailable(database, normalized.name);
  const sourceVoiceId = assertDesignSource(database, normalized.sourceVoiceId);
  const id = randomUUID();
  const now = new Date().toISOString();
  let sampleRecord;
  if (normalized.kind === 'clone') {
    sampleRecord = await writeSample(storageDirectory, id, normalized.sample);
  }

  try {
    database.prepare(`
      INSERT INTO voices (
      id, kind, name, voice_description, sample_file, sample_mime_type,
        sample_file_name, sample_size, source_voice_id, preview_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      normalized.kind,
      normalized.name,
      normalized.voiceDescription ?? null,
      sampleRecord?.sampleFile ?? null,
      normalized.sample?.mimeType ?? null,
      normalizeSampleFileName(normalized.sampleFileName, normalized.kind === 'clone' ? 'voice-sample.' + normalized.sample.extension : null),
      normalized.sample?.bytes.length ?? null,
      sourceVoiceId,
      normalized.previewText,
      now,
      now,
    );
  } catch (error) {
    if (sampleRecord) await removeSample(storageDirectory, sampleRecord.sampleFile);
    throw error;
  }
  return rowToVoice(database.prepare('SELECT * FROM voices WHERE id = ?').get(id));
}

export async function updateVoice(database, storageDirectory, id, payload) {
  const current = readVoiceRow(database, id);
  assertObject(payload, '音色数据必须是对象');
  if (payload.kind !== undefined && payload.kind !== current.kind) {
    throw new VoiceStoreError(400, '音色类型不能直接修改，请创建新的音色');
  }
  if (payload.sourceVoiceId !== undefined) {
    throw new VoiceStoreError(400, '固化来源不能修改，请创建新的音色');
  }
  const name = payload.name === undefined ? current.name : validateName(payload.name);
  assertNameAvailable(database, name, id);
  const now = new Date().toISOString();

  if (current.kind === 'design') {
    if (payload.sampleDataUrl !== undefined) {
      throw new VoiceStoreError(400, '设计音色不能包含复刻样本');
    }
    const description = payload.voiceDescription === undefined ? current.voice_description : validateDescription(payload.voiceDescription);
    const previewText = payload.previewText === undefined ? current.preview_text : validatePreviewText(payload.previewText);
    database.prepare('UPDATE voices SET name = ?, voice_description = ?, preview_text = ?, updated_at = ? WHERE id = ?').run(name, description, previewText, now, id);
    return rowToVoice(database.prepare('SELECT * FROM voices WHERE id = ?').get(id));
  }

  if (payload.voiceDescription !== undefined || payload.previewText !== undefined) {
    throw new VoiceStoreError(400, '音色复刻不能包含设计描述或试听文本');
  }
  if (payload.sampleDataUrl === undefined) {
    database.prepare('UPDATE voices SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
    return rowToVoice(database.prepare('SELECT * FROM voices WHERE id = ?').get(id), await sampleAvailable(storageDirectory, current));
  }

  const sample = parseSampleDataUrl(payload.sampleDataUrl);
  const sampleRecord = await writeSample(storageDirectory, id + '-' + randomUUID(), sample);
  const previousSampleFile = current.sample_file;
  try {
    database.prepare(`
      UPDATE voices
      SET name = ?, sample_file = ?, sample_mime_type = ?, sample_file_name = ?, sample_size = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      sampleRecord.sampleFile,
      sample.mimeType,
      normalizeSampleFileName(payload.sampleFileName, current.sample_file_name),
      sample.bytes.length,
      now,
      id,
    );
  } catch (error) {
    await removeSample(storageDirectory, sampleRecord.sampleFile);
    throw error;
  }
  if (previousSampleFile && previousSampleFile !== sampleRecord.sampleFile) {
    await removeSample(storageDirectory, previousSampleFile);
  }
  return rowToVoice(database.prepare('SELECT * FROM voices WHERE id = ?').get(id));
}

export async function deleteVoice(database, storageDirectory, id) {
  const current = readVoiceRow(database, id);
  database.prepare('DELETE FROM voices WHERE id = ?').run(id);
  database.prepare('DELETE FROM voice_preferences WHERE voice_id = ?').run(id);
  await removeSample(storageDirectory, current.sample_file);
}

export async function readVoiceSample(database, storageDirectory, id) {
  const row = readVoiceRow(database, id);
  if (row.kind !== 'clone') {
    throw new VoiceStoreError(400, '只有音色复刻包含可下载的样本文件');
  }
  const samplePath = resolveSamplePath(storageDirectory, row.sample_file);
  try {
    const sampleStat = await lstat(samplePath);
    if (!sampleStat.isFile() || sampleStat.size !== row.sample_size) {
      throw new VoiceStoreError(404, '音色样本文件已损坏，请重新上传');
    }
    const bytes = await readFile(samplePath);
    try {
      validateSampleSignature(bytes, row.sample_mime_type);
    } catch (error) {
      if (error instanceof VoiceStoreError) {
        throw new VoiceStoreError(404, '音色样本文件已损坏，请重新上传');
      }
      throw error;
    }
    return {
      bytes,
      mimeType: row.sample_mime_type,
      fileName: row.sample_file_name,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new VoiceStoreError(404, '音色样本文件不存在，请重新上传');
    }
    throw error;
  }
}

export function readFavoriteVoiceIds(database) {
  return database.prepare('SELECT voice_id FROM voice_preferences WHERE favorite = 1 ORDER BY voice_id').all().map((row) => row.voice_id);
}

export function writeFavoriteVoice(database, voiceId, favorite) {
  if (typeof voiceId !== 'string' || !voiceId.trim()) {
    throw new VoiceStoreError(400, '音色 ID 不能为空');
  }
  if (typeof favorite !== 'boolean') {
    throw new VoiceStoreError(400, 'favorite 必须是布尔值');
  }
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO voice_preferences (voice_id, favorite, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(voice_id) DO UPDATE SET favorite = excluded.favorite, updated_at = excluded.updated_at
  `).run(voiceId, favorite ? 1 : 0, now);
  if (!favorite) {
    database.prepare('DELETE FROM voice_preferences WHERE voice_id = ? AND favorite = 0').run(voiceId);
  }
}
