/**
 * Звук урока: речь учителя и ученика на слабом канале.
 *
 * Opus 48 кбит/с моно — запас против «шипения» при потерях, но без нагрузки
 * на узкий канал. DTX выключен: на VPN он давал рваное начало фраз.
 * RED (избыточность) и встроенный FEC Opus включены. Обработка браузера
 * (эхо, шум, автоусиление) включена.
 */

export const CALL_AUDIO_MAX_BITRATE = 48_000;

export const CALL_AUDIO_CAPTURE = Object.freeze({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
});

/** publishDefaults LiveKit для микрофона. FEC в Opus браузер включает сам (useinbandfec=1). */
export function liveKitAudioPublish() {
  return {
    audioPreset: { maxBitrate: CALL_AUDIO_MAX_BITRATE },
    dtx: false,
    red: true,
    forceStereo: false,
  };
}

/** config.audioQuality для Jitsi. */
export const JITSI_AUDIO_QUALITY = Object.freeze({
  stereo: false,
  enableOpusDtx: false,
  opusMaxAverageBitrate: CALL_AUDIO_MAX_BITRATE,
});
