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
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { audio: { data: 'data:audio/wav;base64,' + encodeBase64(wavBytes) } } }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const audio = await synthesize({
      endpoint: 'https://api.xiaomimimo.com/v1',
      apiKey: 'test-key',
      mode: 'preset',
      text: '测试语音',
      styleInstruction: '',
      voiceDescription: '',
      voice: '冰糖',
      format: 'wav',
      stream: false,
      optimizeTextPreview: false,
      cloneVoice: undefined,
    });
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
      mode: 'preset',
      text: '测试流式语音',
      styleInstruction: '',
      voiceDescription: '',
      voice: '冰糖',
      format: 'mp3',
      stream: true,
      optimizeTextPreview: false,
      cloneVoice: undefined,
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
