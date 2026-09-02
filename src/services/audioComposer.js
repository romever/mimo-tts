import { pcm16ToWav } from './mimoClient.js';

function getAudioContextConstructor() {
  if (typeof globalThis.AudioContext !== 'function') {
    throw new Error('当前浏览器不支持 Web Audio 音频合成，请使用现代浏览器');
  }
  return globalThis.AudioContext;
}

function getOfflineAudioContextConstructor() {
  if (typeof globalThis.OfflineAudioContext !== 'function') {
    throw new Error('当前浏览器不支持离线音频渲染，无法合成完整音频');
  }
  return globalThis.OfflineAudioContext;
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, value));
}

function audioBufferToPcm16(audioBuffer) {
  const samples = audioBuffer.getChannelData(0);
  const pcmBytes = new Uint8Array(samples.length * 2);
  const view = new DataView(pcmBytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = clampSample(samples[index]);
    const pcmSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(index * 2, pcmSample, true);
  }
  return pcmBytes;
}

async function decodeAudioBlobs(audioContext, audioBlobs) {
  return Promise.all(audioBlobs.map(async (audioBlob, index) => {
    if (!(audioBlob instanceof Blob)) {
      throw new Error('第 ' + (index + 1) + ' 段音频数据无效，无法合成');
    }
    const sourceBytes = await audioBlob.arrayBuffer();
    // decodeAudioData 可能转移传入的 ArrayBuffer，复制一份避免影响后续状态。
    return audioContext.decodeAudioData(sourceBytes.slice(0));
  }));
}

export async function composeAudioSegments(audioBlobs) {
  if (!Array.isArray(audioBlobs) || audioBlobs.length === 0) {
    throw new Error('至少需要一段已生成的音频才能合成完整音频');
  }

  const AudioContextConstructor = getAudioContextConstructor();
  const OfflineAudioContextConstructor = getOfflineAudioContextConstructor();
  const audioContext = new AudioContextConstructor();

  try {
    const decodedBuffers = await decodeAudioBlobs(audioContext, audioBlobs);
    const sampleRate = Math.max(...decodedBuffers.map((audioBuffer) => audioBuffer.sampleRate));
    const totalFrames = decodedBuffers.reduce(
      (total, audioBuffer) => total + Math.ceil(audioBuffer.duration * sampleRate),
      0,
    );
    if (totalFrames <= 0) {
      throw new Error('生成的音频没有有效时长，无法合成完整音频');
    }

    const offlineContext = new OfflineAudioContextConstructor(1, totalFrames, sampleRate);
    offlineContext.destination.channelCount = 1;
    offlineContext.destination.channelCountMode = 'explicit';

    let offsetSeconds = 0;
    decodedBuffers.forEach((audioBuffer) => {
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineContext.destination);
      source.start(offsetSeconds);
      offsetSeconds += audioBuffer.duration;
    });

    const renderedAudio = await offlineContext.startRendering();
    const blob = pcm16ToWav(audioBufferToPcm16(renderedAudio), sampleRate);
    return { blob, duration: renderedAudio.duration };
  } finally {
    await audioContext.close();
  }
}
