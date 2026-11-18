/**
 * Качество демонстрации экрана: текст, формулы, задачи, доска.
 *
 * Цифры ниже — потолки, не обещание картинки. Браузер, мост и слабый канал
 * могут отдать меньше. Жёсткий exact на захват не ставим: он срывает
 * getDisplayMedia в Safari и на части окон.
 *
 * r-call-quality: 5–8 кадров/с вместо 15. Для текста, формул и доски частота
 * почти не важна, а на узком канале (VPN, мобильный интернет) каждый кадр
 * получает больше бит и буквы остаются чёткими. Плюс запасные слои 720p/360p:
 * при слабом канале ученик получает читаемую картинку, а не замирание.
 */

export const SCREEN_SHARE_RECEIVE_HEIGHT = 1080;
export const SCREEN_SHARE_MAX_FPS = 8;
export const SCREEN_SHARE_MIN_FPS = 5;
/** Квадратный потолок: и портрет, и ландшафт. Не exact. */
export const SCREEN_SHARE_CAPTURE_EDGE = 2560;
/** Потолок верхнего слоя при 8 к/с: на кадр приходится больше бит, чем было при 15 к/с и 4 Мбит/с. */
export const SCREEN_SHARE_BITRATE_CAP = 2_500_000;

/**
 * Запасные слои демонстрации (LiveKit simulcast), от меньшего к большему.
 * Верхний слой — полный захват с SCREEN_SHARE_BITRATE_CAP.
 */
export const SCREEN_SHARE_BACKUP_LAYERS = Object.freeze([
  Object.freeze({ width: 640, height: 360, maxBitrate: 200_000, maxFramerate: 3 }),
  Object.freeze({ width: 1280, height: 720, maxBitrate: 700_000, maxFramerate: SCREEN_SHARE_MIN_FPS }),
]);

/** Jitsi: только потолок. Жёсткий min раньше срывал захват в части браузеров. */
export const JITSI_SCREEN_SHARE_FRAME_RATE = Object.freeze({
  max: SCREEN_SHARE_MAX_FPS,
});

/**
 * ssHigh — только дорожка демонстрации, не камера.
 * VP9 экономнее; VP8/H264 (в том числе Safari/мобильный кодек) нужен больший потолок.
 */
export function jitsiScreenShareBitrateCaps() {
  return {
    vp9: 2_500_000,
    vp8: 3_000_000,
    h264: 3_000_000,
  };
}

/** Развёрнутый показ просит высокий слой. Свёрнутая полоска и «слабое соединение» — нет. */
export function screenShareViewWantsDetail({
  expanded = true,
  minimized = false,
  weak = false,
} = {}) {
  if (weak || minimized) return false;
  return expanded !== false;
}

export const SCREEN_SHARE_CAPTURE = Object.freeze({
  resolution: {
    width: SCREEN_SHARE_CAPTURE_EDGE,
    height: SCREEN_SHARE_CAPTURE_EDGE,
  },
  contentHint: "detail",
});

export function liveKitScreenShareEncoding() {
  return {
    maxBitrate: SCREEN_SHARE_BITRATE_CAP,
    maxFramerate: SCREEN_SHARE_MAX_FPS,
    priority: "high",
  };
}

/** Форма VideoPreset LiveKit (width, height, encoding) без импорта SDK. */
export function liveKitScreenShareLayers() {
  return SCREEN_SHARE_BACKUP_LAYERS.map((layer) => ({
    width: layer.width,
    height: layer.height,
    aspectRatio: layer.width / layer.height,
    encoding: { maxBitrate: layer.maxBitrate, maxFramerate: layer.maxFramerate },
    resolution: {
      width: layer.width,
      height: layer.height,
      frameRate: layer.maxFramerate,
      aspectRatio: layer.width / layer.height,
    },
  }));
}

export function liveKitScreenSharePublish() {
  return {
    screenShareEncoding: liveKitScreenShareEncoding(),
    screenShareSimulcastLayers: liveKitScreenShareLayers(),
    simulcast: true,
    degradationPreference: "maintain-resolution",
  };
}

/**
 * Повтор захвата без рамки разрешения, если браузер отверг ограничения.
 * Отказ человека (NotAllowedError) не маскируем вторым запросом.
 */
export function screenShareCaptureFallback(error) {
  const name = String(error?.name || "");
  if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") return null;
  return { contentHint: "detail" };
}

/**
 * Сбросить застрявшую подписку на низкий слой, когда показ развёрнут.
 * Маленькая плитка по-прежнему ограничивается размером элемента (adaptive stream).
 */
export function refreshScreenShareSubscription(room, source, {
  expanded = true,
  highQuality,
} = {}) {
  if (!room || expanded === false || highQuality == null || !source) return [];
  const updated = [];
  room.remoteParticipants?.forEach?.((participant) => {
    const publication = participant?.getTrackPublication?.(source);
    if (!publication || typeof publication.setVideoQuality !== "function") return;
    publication.setVideoQuality(highQuality);
    updated.push(String(participant.identity || participant.sid || ""));
  });
  return updated;
}
