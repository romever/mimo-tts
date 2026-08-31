import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceProfile } from '../src/services/voiceClient.js';

test('保存固化复刻音色会把来源设计音色 ID 交给本地服务', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: 'clone-1',
      kind: 'clone',
      name: '深夜电台 · 复刻版',
      sourceVoiceId: 'design-1',
      sample: { mimeType: 'audio/wav', fileName: 'solidified.wav', size: 64, available: true },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await createVoiceProfile({
      kind: 'clone',
      name: '深夜电台 · 复刻版',
      sourceVoiceId: 'design-1',
      sampleDataUrl: 'data:audio/wav;base64,AAAA',
      sampleFileName: 'solidified.wav',
    });
    assert.equal(requestBody.sourceVoiceId, 'design-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
