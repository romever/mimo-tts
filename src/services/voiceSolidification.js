export function buildCloneDraftFromPreview(voice, previewSample) {
  if (!voice || voice.kind !== 'design' || typeof voice.id !== 'string' || typeof voice.name !== 'string') {
    throw new Error('只有有效的设计音色才能固化为复刻音色');
  }
  if (!previewSample || typeof previewSample.dataUrl !== 'string' || !previewSample.dataUrl.startsWith('data:')) {
    throw new Error('请先试听设计音色，再保存为复刻音色');
  }

  // 固化只包装已试听的样本，不再次调用模型，确保用户保存的就是刚才听到的声音。
  return {
    name: voice.name + ' · 复刻版',
    sourceVoiceId: voice.id,
    sample: {
      dataUrl: previewSample.dataUrl,
      fileName: previewSample.fileName,
      mimeType: previewSample.mimeType,
      size: previewSample.size,
      isNew: true,
    },
  };
}
