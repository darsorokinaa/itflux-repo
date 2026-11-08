/**
 * Качество демонстрации экрана: текст, формулы, задачи, доска.
 *
 * Цифры ниже — потолки, не обещание картинки. Браузер, мост и слабый канал
 * могут отдать меньше. Жёсткий exact на захват не ставим: он срывает
 * getDisplayMedia в Safari и на части окон.
 */

export const SCREEN_SHARE_RECEIVE_HEIGHT = 1080;
export const SCREEN_SHARE_MAX_FPS = 15;
/** Квадратный потолок: и портрет, и ландшафт. Не exact. */
export const SCREEN_SHARE_CAPTURE_EDGE = 2560;
/** Потолок кодирования статичного экрана. Выше прежнего 1,2 Мбит/с и дефолта 2,5. */
export const SCREEN_SHARE_BITRATE_CAP = 4_000_000;

export const JITSI_SCREEN_SHARE_FRAME_RATE = Object.freeze({
  max: SCREEN_SHARE_MAX_FPS,
});

/**
 * ssHigh — только дорожка демонстрации, не камера.
 * VP9 экономнее; VP8/H264 (в том числе Safari/мобильный кодек) нужен больший потолок.
 */
export function jitsiScreenShareBitrateCaps() {
  return {
    vp9: 4_500_000,
    vp8: 5_000_000,
    h264: 5_000_000,
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

export function liveKitScreenSharePublish() {
  return {
    screenShareEncoding: liveKitScreenShareEncoding(),
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
