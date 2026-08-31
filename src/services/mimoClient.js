const MODEL_IDS = {
  preset: 'mimo-v2.5-tts',
  design: 'mimo-v2.5-tts-voicedesign',
  clone: 'mimo-v2.5-tts-voiceclone',
};

// 设计与复刻音色都需要跨请求保持声音身份，固定较低温度以减少听感上的随机漂移。
const LOW_VARIANCE_TTS_TEMPERATURE = 0.2;

export function modelIdFor(mode) {
  const modelId = MODEL_IDS[mode];
  if (!modelId) {
    throw new Error('未识别的 MiMo TTS 模式');
  }
  return modelId;
}

function completionUrl(endpoint) {
  const baseUrl = endpoint.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('请填写 API Base URL');
  }
  return baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';
}

function normalizeBase64Payload(payload) {
  if (typeof payload !== 'string') {
    throw new Error('MiMo API 音频数据不是字符串');
  }

  const trimmed = payload.trim();
  const dataUrlMatch = /^data:[^;,]+;base64,(.*)$/s.exec(trimmed);
  if (dataUrlMatch) {
    return dataUrlMatch[1].replace(/\s/g, '');
  }
  if (trimmed.startsWith('data:')) {
    throw new Error('MiMo API 音频 data URL 缺少有效的 Base64 编码');
  }
  return trimmed.replace(/\s/g, '');
}

function decodeBase64(payload) {
  const binary = atob(normalizeBase64Payload(payload));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  return bytes;
}

export function pcm16ToWav(pcmBytes, sampleRate = 24000) {
  const wav = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(wav);
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcmBytes.length, true);
  new Uint8Array(wav, 44).set(pcmBytes);
  return new Blob([wav], { type: 'audio/wav' });
}

function startsWithBytes(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function isMpegAudio(bytes) {
  if (startsWithBytes(bytes, [0x49, 0x44, 0x33])) {
    return true;
  }
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0;
}

function audioBlobFromPayload(payload, format) {
  const bytes = decodeBase64(payload);
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(bytes.subarray(8), [0x57, 0x41, 0x56, 0x45])) {
    return new Blob([bytes], { type: 'audio/wav' });
  }
  if (isMpegAudio(bytes)) {
    return new Blob([bytes], { type: 'audio/mpeg' });
  }
  if (format === 'pcm16') {
    return pcm16ToWav(bytes);
  }
  throw new Error('MiMo API 返回的音频格式无法识别，请检查 audio.format 与响应内容');
}

export function outputFormatFor({ mode, format, stream }) {
  return mode === 'preset' && stream ? 'wav' : format;
}

export function fileExtensionForAudioBlob(audioBlob) {
  if (audioBlob.type === 'audio/wav') return 'wav';
  if (audioBlob.type === 'audio/mpeg') return 'mp3';
  throw new Error('生成的音频类型无法确定文件扩展名');
}

async function readStreamingAudio(response) {
  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let buffer = '';

  const consumeLine = (line) => {
    const normalized = line.trim();
    if (!normalized.startsWith('data:')) {
      return;
    }
    const payload = normalized.slice(5).trim();
    if (payload === '[DONE]') {
      return;
    }
    const chunk = JSON.parse(payload);
    const audioData = chunk.choices?.[0]?.delta?.audio?.data;
    if (audioData) {
      chunks.push(decodeBase64(audioData));
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      consumeLine(line);
    }

    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    consumeLine(buffer);
  }

  if (!chunks.length) {
    throw new Error('流式响应中没有收到音频数据');
  }
  return pcm16ToWav(concatBytes(chunks));
}

function buildMessages({ voiceProfile, text, styleInstruction }) {
  const messages = [];
  const userContent = voiceProfile.kind === 'design' ? voiceProfile.voiceDescription.trim() : styleInstruction.trim();
  if (userContent) {
    messages.push({ role: 'user', content: userContent });
  }
  messages.push({ role: 'assistant', content: text.trim() });
  return messages;
}

function validateVoiceProfile(voiceProfile) {
  if (!voiceProfile || typeof voiceProfile !== 'object' || !['preset', 'design', 'clone'].includes(voiceProfile.kind)) {
    throw new Error('未选择有效的音色');
  }
  if (voiceProfile.kind === 'preset' && typeof voiceProfile.providerVoiceId !== 'string') {
    throw new Error('预置音色缺少 MiMo 音色 ID');
  }
  if (voiceProfile.kind === 'design' && (typeof voiceProfile.voiceDescription !== 'string' || !voiceProfile.voiceDescription.trim())) {
    throw new Error('设计音色缺少音色描述');
  }
  if (voiceProfile.kind === 'clone' && (typeof voiceProfile.sampleDataUrl !== 'string' || !voiceProfile.sampleDataUrl.startsWith('data:'))) {
    throw new Error('音色复刻缺少有效的样本数据');
  }
}

export async function synthesize({
  endpoint,
  apiKey,
  voiceProfile,
  text,
  styleInstruction,
  format,
  stream,
  optimizeTextPreview,
}) {
  if (!apiKey.trim()) {
    throw new Error('请先在 API 设置中配置 API Key');
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('合成文本不能为空');
  }
  if (typeof styleInstruction !== 'string') {
    throw new Error('风格指令必须是字符串');
  }
  validateVoiceProfile(voiceProfile);
  const mode = voiceProfile.kind;

  const effectiveStream = mode === 'preset' && stream;
  const outputFormat = outputFormatFor({ mode, format, stream });
  const audio = {
    format: effectiveStream ? 'pcm16' : format,
  };

  if (mode === 'preset') {
    audio.voice = voiceProfile.providerVoiceId;
  }
  if (mode === 'design') {
    audio.optimize_text_preview = optimizeTextPreview;
  }
  if (mode === 'clone') {
    audio.voice = voiceProfile.sampleDataUrl;
  }

  const requestBody = {
    model: modelIdFor(mode),
    messages: buildMessages({ voiceProfile, text, styleInstruction }),
    audio,
    stream: effectiveStream,
  };
  if (mode === 'design' || mode === 'clone') {
    requestBody.temperature = LOW_VARIANCE_TTS_TEMPERATURE;
  }

  const response = await fetch(completionUrl(endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey.trim(),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error('MiMo API 请求失败（' + response.status + '）：' + (message || '服务端未返回错误信息'));
  }

  if (effectiveStream) {
    return readStreamingAudio(response);
  }

  const payload = await response.json();
  const base64Audio = payload.choices?.[0]?.message?.audio?.data;
  if (!base64Audio) {
    throw new Error('MiMo API 响应中没有音频数据');
  }
  return audioBlobFromPayload(base64Audio, outputFormat);
}

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取音色样本失败'));
    reader.readAsDataURL(file);
  });
}
