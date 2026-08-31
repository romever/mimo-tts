import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCloneDraftFromPreview } from '../src/services/voiceSolidification.js';

test('设计音色试听后会使用同一份样本创建复刻草稿', () => {
  const previewSample = {
    dataUrl: 'data:audio/wav;base64,UklGRgAAAAA=',
    fileName: '深夜电台-试听.wav',
    mimeType: 'audio/wav',
    size: 42,
  };

  const draft = buildCloneDraftFromPreview(
    { id: 'design-1', kind: 'design', name: '深夜电台' },
    previewSample,
  );

  assert.deepEqual(draft, {
    name: '深夜电台 · 复刻版',
    sourceVoiceId: 'design-1',
    sample: {
      ...previewSample,
      isNew: true,
    },
  });
  assert.equal(draft.sample.dataUrl, previewSample.dataUrl);
});

test('没有设计音色试听样本时不能创建复刻草稿', () => {
  assert.throws(
    () => buildCloneDraftFromPreview({ id: 'design-1', kind: 'design', name: '深夜电台' }, null),
    /请先试听设计音色/,
  );
});
