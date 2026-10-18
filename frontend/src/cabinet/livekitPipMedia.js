import { Track } from "livekit-client";

/**
 * Что показать в окне «поверх окон» (r72): собеседник (говорящий или первый),
 * своя камера и состояние кнопок. Треки LiveKit отдаём как есть (attach/detach),
 * не клонируем и не останавливаем.
 */
export function pickPipMedia(room, { dominantId = "", micOn = false, camOn = false } = {}) {
  const remotes = [];
  room?.remoteParticipants?.forEach?.((participant) => remotes.push(participant));
  const remote = remotes.find((p) => p.identity === dominantId)
    || remotes.find((p) => {
      const pub = p.getTrackPublication?.(Track.Source.Camera);
      return Boolean(pub?.track) && pub.isMuted !== true;
    })
    || remotes[0]
    || null;
  const remotePub = remote?.getTrackPublication?.(Track.Source.Camera) || null;
  const remoteTrack = remotePub?.track || null;
  const local = room?.localParticipant || null;
  const localPub = local?.getTrackPublication?.(Track.Source.Camera) || null;
  const localTrack = localPub?.track || null;
  return {
    remote: {
      source: remoteTrack,
      name: remote ? (remote.name || "Участник") : "",
      waiting: !remote,
      cameraOff: !remoteTrack || remotePub?.isMuted === true,
    },
    local: {
      source: localTrack,
      cameraOff: !camOn || !localTrack || localPub?.isMuted === true,
    },
    micOn: Boolean(micOn),
    camOn: Boolean(camOn),
  };
}
