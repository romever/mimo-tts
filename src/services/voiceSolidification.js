export function buildCloneDraftFromPreview(voice, previewSample) {
  if (!voice || voice.kind !== 'design' || typeof voice.name !== 'string' || !voice.name.trim()) {
    throw new Error('只有有效的设计音色才能固化为复刻音色');
  }
  if (!previewSample || typeof previewSample.dataUrl !== 'string' || !previewSample.dataUrl.startsWith('data:')) {
    throw new Error('请先试听设计音色，再保存为复刻音色');
  }

  // 固化只包装已试听的样本，不再次调用模型，确保用户保存的就是刚才听到的声音。
  const draft = {
    name: voice.name + ' · 复刻版',
    sample: {
      dataUrl: previewSample.dataUrl,
      fileName: previewSample.fileName,
      mimeType: previewSample.mimeType,
      size: previewSample.size,
      isNew: true,
    },
  };
  if (voice.id !== undefined && (typeof voice.id !== 'string' || !voice.id.trim())) {
    throw new Error('设计音色 ID 无效');
  }
  if (voice.id) draft.sourceVoiceId = voice.id;
  return draft;
}
