const SETTINGS_URL = '/api/settings';

function validateSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('本地配置服务返回的数据格式无效');
  }
  if (typeof payload.endpoint !== 'string' || typeof payload.apiKey !== 'string') {
    throw new Error('本地配置服务返回的 API 配置不完整');
  }
  return {
    endpoint: payload.endpoint,
    apiKey: payload.apiKey,
  };
}

async function readError(response, action) {
  const message = await response.text();
  return new Error(action + '失败（' + response.status + '）：' + (message || '本地配置服务未返回错误信息'));
}

export async function loadApiSettings() {
  const response = await fetch(SETTINGS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw await readError(response, '读取本地 API 配置');
  }
  return validateSettingsPayload(await response.json());
}

export async function saveApiSettings(settings) {
  const response = await fetch(SETTINGS_URL, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw await readError(response, '保存本地 API 配置');
  }
  return validateSettingsPayload(await response.json());
}
