export function syncPlaybackPosition(audio, progress, shouldSeek) {
  if (!shouldSeek || !audio || !Number.isFinite(audio.duration)) {
    return;
  }
  audio.currentTime = progress * audio.duration;
}
