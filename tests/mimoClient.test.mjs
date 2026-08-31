import assert from 'node:assert/strict';
import test from 'node:test';
import { syncPlaybackPosition } from '../src/services/audioPlayback.js';
import { pcm16ToWav, synthesize } from '../src/services/mimoClient.js';

function encodeBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

test('播放进度回调不会反复 seek，只有用户主动拖动时才修改 currentTime', () => {
  const audio = { duration: 10, currentTime: 3 };
  syncPlaybackPosition(audio, 0.5, false);
  assert.equal(audio.currentTime, 3);
  syncPlaybackPosition(audio, 0.5, true);
  assert.equal(audio.currentTime, 5);
});

async function createWavBytes() {
  const wav = pcm16ToWav(new Uint8Array([0, 0, 64, 0]), 24000);
  return new Uint8Array(await wav.arrayBuffer());
}

test('非流式响应带 data URL 前缀时仍能得到可播放 WAV', async () => {
  const wavBytes = await createWavBytes();
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
    choices: [{ message: { audio: { data: 'data:audio/wav;base64,' + encodeBase64(wavBytes) } } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const audio = await synthesize({
      endpoint: 'https://api.xiaomimimo.com/v1',
      apiKey: 'test-key',
      voiceProfile: { id: 'preset:冰糖', kind: 'preset', name: '冰糖', providerVoiceId: '冰糖' },
      text: '测试语音',
      styleInstruction: '',
      format: 'wav',
      stream: false,
      optimizeTextPreview: false,
    });
    assert.equal(requestBody.model, 'mimo-v2.5-tts');
    assert.equal(requestBody.audio.voice, '冰糖');
    assert.equal(audio.type, 'audio/wav');
    assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('预置音色流式响应会把 24kHz PCM16 拼接并封装为 WAV', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  const chunks = [new Uint8Array([0, 0]), new Uint8Array([64, 0])];
  const streamBody = chunks.map((chunk) => 'data: ' + JSON.stringify({
    choices: [{ delta: { audio: { data: encodeBase64(chunk) } } }],
  })).join('\n\n') + '\n\ndata: [DONE]\n\n';
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const audio = await synthesize({
      endpoint: 'https://api.xiaomimimo.com/v1',
      apiKey: 'test-key',
      voiceProfile: { id: 'preset:冰糖', kind: 'preset', name: '冰糖', providerVoiceId: '冰糖' },
      text: '测试流式语音',
      styleInstruction: '',
      format: 'mp3',
      stream: true,
      optimizeTextPreview: false,
    });
    const wavBytes = new Uint8Array(await audio.arrayBuffer());
    const wavView = new DataView(wavBytes.buffer);
    assert.equal(requestBody.audio.format, 'pcm16');
    assert.equal(requestBody.stream, true);
    assert.equal(audio.type, 'audio/wav');
    assert.equal(Buffer.from(wavBytes).subarray(0, 4).toString(), 'RIFF');
    assert.equal(wavView.getUint32(24, true), 24000);
    assert.equal(wavView.getUint16(22, true), 1);
    assert.equal(wavView.getUint16(34, true), 16);
    assert.equal(wavBytes.length, 48);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('设计音色与复刻音色会使用已保存的音色资产映射请求', async () => {
  const wavBytes = await createWavBytes();
  const sampleDataUrl = 'data:audio/wav;base64,' + encodeBase64(wavBytes);
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  globalThis.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{ message: { audio: { data: encodeBase64(wavBytes) } } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await synthesize({
      endpoint: 'https://api.xiaomimimo.com/v1',
      apiKey: 'test-key',
      voiceProfile: { id: 'design-1', kind: 'design', name: '深夜女声', voiceDescription: '温柔、清亮、语速稍慢。' },
      text: '设计音色测试',
      styleInstruction: '本次生成要自然',
      format: 'wav',
      stream: false,
      optimizeTextPreview: true,
    });
    await synthesize({
      endpoint: 'https://api.xiaomimimo.com/v1',
      apiKey: 'test-key',
      voiceProfile: { id: 'clone-1', kind: 'clone', name: '样本女声', sampleDataUrl },
      text: '复刻音色测试',
      styleInstruction: '本次生成要清晰',
      format: 'wav',
      stream: false,
      optimizeTextPreview: false,
    });
    assert.equal(requestBodies[0].model, 'mimo-v2.5-tts-voicedesign');
    assert.equal(requestBodies[0].messages[0].content, '温柔、清亮、语速稍慢。');
    assert.equal(requestBodies[0].audio.optimize_text_preview, true);
    assert.equal(requestBodies[0].temperature, 0.2);
    assert.equal(requestBodies[1].model, 'mimo-v2.5-tts-voiceclone');
    assert.equal(requestBodies[1].audio.voice, sampleDataUrl);
    assert.equal(requestBodies[1].messages[0].content, '本次生成要清晰');
    assert.equal(requestBodies[1].temperature, 0.2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
