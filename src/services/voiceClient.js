const VOICES_URL = '/api/voices';

async function readError(response, action) {
  const message = await response.text();
  let detail = message;
  try {
    const payload = JSON.parse(message);
    if (payload && typeof payload.error === 'string') detail = payload.error;
  } catch {
    // 非 JSON 错误响应仍保留原始响应内容，便于定位本地服务问题。
  }
  return new Error(action + '失败（' + response.status + '）：' + (detail || '本地服务未返回错误信息'));
}

async function requestJson(url, options, action) {
  const response = await fetch(url, options);
  if (!response.ok) throw await readError(response, action);
  if (response.status === 204) return null;
  return response.json();
}

function validateVoiceProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('本地音色服务返回的数据格式无效');
  }
  if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || !['design', 'clone'].includes(profile.kind)) {
    throw new Error('本地音色服务返回的音色数据不完整');
  }
  if (profile.kind === 'design' && typeof profile.voiceDescription !== 'string') {
    throw new Error('本地音色服务返回的设计描述无效');
  }
  if (profile.kind === 'clone') {
    if (!profile.sample || typeof profile.sample !== 'object' || typeof profile.sample.available !== 'boolean') {
      throw new Error('本地音色服务返回的复刻样本信息无效');
    }
  }
  if (profile.sourceVoiceId !== null && profile.sourceVoiceId !== undefined && typeof profile.sourceVoiceId !== 'string') {
    throw new Error('本地音色服务返回的固化来源无效');
  }
  return profile;
}

function validateListPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.voices) || !Array.isArray(payload.favoriteIds)) {
    throw new Error('本地音色服务返回的列表数据无效');
  }
  return {
    voices: payload.voices.map(validateVoiceProfile),
    favoriteIds: payload.favoriteIds.map((id) => {
      if (typeof id !== 'string') throw new Error('本地音色服务返回的收藏数据无效');
      return id;
    }),
  };
}

function jsonOptions(method, payload) {
  return {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
}

function buildPayload(input) {
  const payload = {
    kind: input.kind,
    name: input.name,
  };
  if (input.kind === 'design') {
    payload.voiceDescription = input.voiceDescription;
  }
  if (input.kind === 'clone' && input.sampleDataUrl) {
    payload.sampleDataUrl = input.sampleDataUrl;
    payload.sampleFileName = input.sampleFileName;
    if (input.sourceVoiceId) payload.sourceVoiceId = input.sourceVoiceId;
  }
  return payload;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取音色样本失败'));
    reader.readAsDataURL(blob);
  });
}

export async function loadVoiceProfiles() {
  const payload = await requestJson(VOICES_URL, { headers: { Accept: 'application/json' } }, '读取本地音色');
  return validateListPayload(payload);
}

export async function createVoiceProfile(input) {
  return validateVoiceProfile(await requestJson(VOICES_URL, jsonOptions('POST', buildPayload(input)), '保存音色'));
}

export async function updateVoiceProfile(id, input) {
  return validateVoiceProfile(await requestJson(VOICES_URL + '/' + encodeURIComponent(id), jsonOptions('PATCH', buildPayload(input)), '保存音色'));
}

export async function deleteVoiceProfile(id) {
  await requestJson(VOICES_URL + '/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json' } }, '删除音色');
}

export async function loadVoiceSample(id) {
  const response = await fetch(VOICES_URL + '/' + encodeURIComponent(id) + '/sample', {
    headers: { Accept: 'audio/mpeg, audio/wav' },
  });
  if (!response.ok) throw await readError(response, '读取音色样本');
  return blobToDataUrl(await response.blob());
}

export async function setVoiceFavorite(id, favorite) {
  const payload = await requestJson('/api/voice-preferences/' + encodeURIComponent(id), jsonOptions('PUT', { favorite }), '更新音色收藏');
  if (!payload || payload.voiceId !== id || typeof payload.favorite !== 'boolean') {
    throw new Error('本地音色服务返回的收藏结果无效');
  }
  return payload;
}
