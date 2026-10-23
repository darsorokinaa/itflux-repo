import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";

import { disconnectVideoMeetingParticipant } from "../../utils/cabinetAuth";
import { ConferenceControls, ConferenceSide } from "./ConferenceChrome";
import { screenShareSupported } from "../conferenceCommands";
import { participantInitials } from "../participantVideo";
import { pickPipMedia } from "../livekitPipMedia";
import {
  MEDIA_RESTORE_NOTICE,
  MEDIA_RESTORED_NOTICE,
  MEDIA_SCREEN_NOTE,
  describeCallReadiness,
  nextPublishIntent,
  reconnectDelayMs,
} from "../videoFailover";

function useAttachedTrack(track) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return ref;
}

/**
 * Ориентация экрана планшета меняется на лету (portrait <-> landscape): videoWidth/Height
 * приходят через событие "resize" у <video>. Отдаём класс ориентации, чтобы плитка пересчиталась.
 */
export function orientationFromSize(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0 && h > 0)) return "";
  if (h > w * 1.05) return "portrait";
  if (w > h * 1.05) return "landscape";
  return "square";
}

function useVideoOrientation(ref, enabled) {
  const [orientation, setOrientation] = useState("");
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return undefined;
    const update = () => setOrientation(orientationFromSize(element.videoWidth, element.videoHeight));
    update();
    element.addEventListener("resize", update);
    element.addEventListener("loadedmetadata", update);
    return () => {
      element.removeEventListener("resize", update);
      element.removeEventListener("loadedmetadata", update);
    };
  }, [ref, enabled]);
  return orientation;
}

function MediaTile({ track, muted = false, label, audio = false, avatar = false, pipRole = "", screen = false }) {
  const ref = useAttachedTrack(avatar ? null : track);
  const orientation = useVideoOrientation(ref, screen && !avatar && !audio);
  if (audio) {
    return <audio ref={ref} autoPlay playsInline />;
  }
  if (avatar) {
    return (
      <figure className="lk-fallback-tile lk-fallback-tile--avatar">
        <div className="lk-fallback-avatar">{participantInitials(label)}</div>
        <figcaption>{label}</figcaption>
      </figure>
    );
  }
  return (
    <figure
      className={screen ? "lk-fallback-tile lk-fallback-tile--screen" : "lk-fallback-tile"}
      data-orientation={screen ? orientation || undefined : undefined}
    >
      <video ref={ref} autoPlay playsInline muted={muted} data-call-pip-video={pipRole || undefined} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

// Без фиксированного 1920x1080: квадратная рамка-ограничение подходит и для портрета, и для ландшафта
// (по умолчанию LiveKit просит 1920x1080 и при повороте планшета кадр масштабируется под старый формат).
export const SCREEN_SHARE_CAPTURE = Object.freeze({
  resolution: { width: 1920, height: 1920, frameRate: 15 },
  contentHint: "detail",
});

const AUDIO_CONFIRM_MS = 8000;

/**
 * События LiveKit вызывают слушатель с публикацией трека.
 * Такой объект нельзя принимать за флаг «только звук»: иначе пропадают чужие камеры.
 */
export function audioOnlyForTileRefresh(argument, current = false) {
  return typeof argument === "boolean" ? argument : current === true;
}

export function collectTiles(room, { audioOnly }) {
  const tiles = [];
  const audios = [];
  const local = room?.localParticipant;
  if (local) {
    const camera = local.getTrackPublication?.(Track.Source.Camera)?.track;
    const screen = local.getTrackPublication?.(Track.Source.ScreenShare)?.track;
    const label = local.name || "Вы";
    if (camera && !audioOnly) tiles.push({ key: "local-camera", track: camera, label, muted: true });
    else tiles.push({ key: "local-avatar", avatar: true, label });
    if (screen && !audioOnly) tiles.push({ key: "local-screen", track: screen, label: "Ваш экран", muted: true, screen: true });
    // Свой микрофон в <audio> не вставляем: браузер проигрывает его обратно.
  }
  room?.remoteParticipants?.forEach?.((participant) => {
    const camera = participant.getTrackPublication?.(Track.Source.Camera)?.track;
    const mic = participant.getTrackPublication?.(Track.Source.Microphone)?.track;
    const screen = participant.getTrackPublication?.(Track.Source.ScreenShare)?.track;
    const label = participant.name || "Участник";
    if (camera && !audioOnly) tiles.push({ key: `${participant.identity}-camera`, track: camera, label, muted: false, pipRole: "remote" });
    else tiles.push({ key: `${participant.identity}-avatar`, avatar: true, label });
    if (screen && !audioOnly) tiles.push({ key: `${participant.identity}-screen`, track: screen, label: `${label}: экран`, muted: false, screen: true });
    if (mic) audios.push({ key: `${participant.identity}-mic`, track: mic });
  });
  return { tiles, audios };
}

const DEVICE_KIND = {
  audioInput: "audioinput",
  audioOutput: "audiooutput",
  videoInput: "videoinput",
};

export function liveKitConferenceStatus(status, notice = "") {
  if (status === "reconnecting") {
    return { phase: "reconnecting", title: "Восстанавливаем соединение", showReconnect: false, ready: false };
  }
  if (status === "failed" || status === "disconnected") {
    return {
      phase: "failed",
      title: notice || "Не удалось подключить видеосвязь",
      showReconnect: true,
      ready: true,
    };
  }
  if (status === "removed") {
    return { phase: "failed", title: notice || "Видеосвязь отключена", showReconnect: false, ready: true };
  }
  if (status === "connecting" || status === "checking") {
    return { phase: "connecting", title: "Подключаемся к занятию", showReconnect: false, ready: status === "checking" };
  }
  if (notice) return { phase: "info", title: notice, showReconnect: false, ready: true };
  return { phase: "", title: "", showReconnect: false, ready: true };
}

function mapDevices(list) {
  return (Array.isArray(list) ? list : []).map((device) => ({
    deviceId: device.deviceId,
    label: device.label || "",
  }));
}

const LiveKitCallView = forwardRef(function LiveKitCallView({
  meetingUuid,
  url,
  token,
  canModerate = false,
  displayName = "",
  startWithAudioMuted = false,
  startWithVideoMuted = false,
  recovering = false,
  controls = true,
  refreshCredentials,
  onConnected,
  onParticipants,
  onFault,
  onLeave,
  onStateChange,
}, ref) {
  const roomRef = useRef(null);
  const intentRef = useRef({ micOn: !startWithAudioMuted, camOn: !startWithVideoMuted, screenSharing: false });
  const attemptRef = useRef(0);
  const goneRef = useRef(false);
  const audioOnlyRef = useRef(false);
  const handsRef = useRef(new Map());
  const handRaisedRef = useRef(false);
  const actionsRef = useRef({});
  const onStateChangeRef = useRef(onStateChange);
  const onLeaveRef = useRef(onLeave);
  onStateChangeRef.current = onStateChange;
  onLeaveRef.current = onLeave;
  const [status, setStatus] = useState("connecting");
  const [notice, setNotice] = useState(recovering ? MEDIA_RESTORE_NOTICE : "");
  const recoveringRef = useRef(recovering);
  const refreshCredentialsRef = useRef(refreshCredentials);
  const onConnectedRef = useRef(onConnected);
  const onFaultRef = useRef(onFault);
  recoveringRef.current = recovering;
  refreshCredentialsRef.current = refreshCredentials;
  onConnectedRef.current = onConnected;
  onFaultRef.current = onFault;
  const [tiles, setTiles] = useState([]);
  const [audios, setAudios] = useState([]);
  const [, setAudioOnly] = useState(false);
  const [micOn, setMicOn] = useState(!startWithAudioMuted);
  const [camOn, setCamOn] = useState(!startWithVideoMuted);
  const [sharing, setSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [tileWide, setTileWide] = useState(false);
  const [messages, setMessages] = useState([]);
  const [dominantId, setDominantId] = useState("");
  const [handVersion, setHandVersion] = useState(0);
  const [sideTab, setSideTab] = useState("");
  const [unreadChat, setUnreadChat] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const [remotes, setRemotes] = useState([]);
  const [busy, setBusy] = useState("");
  const sideTabRef = useRef("");
  sideTabRef.current = sideTab;
  handRaisedRef.current = handRaised;

  const refreshTiles = (maybeFlag) => {
    const room = roomRef.current;
    if (!room) return;
    const next = collectTiles(room, {
      audioOnly: audioOnlyForTileRefresh(maybeFlag, audioOnlyRef.current),
    });
    setTiles(next.tiles);
    setAudios(next.audios);
    const people = [];
    room.remoteParticipants?.forEach?.((participant) => {
      const micPub = participant.getTrackPublication?.(Track.Source.Microphone);
      people.push({
        identity: participant.identity,
        name: participant.name || "Участник",
        audioMuted: micPub ? micPub.isMuted === true : true,
      });
    });
    setRemotes(people);
    onParticipants?.(1 + people.length);
  };

  useEffect(() => {
    goneRef.current = false;
    let timer = 0;
    let sampler = 0;
    const iceRef = { current: false };
    const packetsRef = { current: null };
    const confirmStartedRef = { current: 0 };
    const mediaReadyRef = { current: false };
    const stalledRef = { current: false };
    const loweredRef = { current: false };
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        dtx: true,
        red: true,
        screenShareEncoding: { maxBitrate: 1_200_000, maxFramerate: 15 },
      },
    });
    roomRef.current = room;

    const applyIntent = async () => {
      const intent = nextPublishIntent(intentRef.current);
      intentRef.current = intent;
      await room.localParticipant.setMicrophoneEnabled(intent.micOn);
      await room.localParticipant.setCameraEnabled(intent.camOn && !audioOnlyRef.current);
      setMicOn(intent.micOn);
      setCamOn(intent.camOn && !audioOnlyRef.current);
      setSharing(false);
    };

    const fail = (info) => {
      if (goneRef.current) return;
      onFaultRef.current?.({ ...info, attempt: attemptRef.current });
    };

    const microphonePublication = () => (
      room.localParticipant.getTrackPublication?.(Track.Source.Microphone)
    );

    const evaluate = () => {
      const publication = microphonePublication();
      const mediaTrack = publication?.track?.mediaStreamTrack;
      const micLive = Boolean(mediaTrack && mediaTrack.readyState === "live" && publication?.isMuted !== true);
      const timedOut = Boolean(
        confirmStartedRef.current
        && Date.now() - confirmStartedRef.current >= AUDIO_CONFIRM_MS
      );
      const readiness = describeCallReadiness({
        iceConnected: iceRef.current,
        micIntended: intentRef.current.micOn,
        micLive,
        packetsSent: packetsRef.current,
        timedOut,
      });
      if (readiness === "media") {
        stalledRef.current = false;
        setStatus("connected");
        if (!mediaReadyRef.current) {
          mediaReadyRef.current = true;
          if (recoveringRef.current || attemptRef.current > 0) setNotice(MEDIA_RESTORED_NOTICE);
          onConnectedRef.current?.();
        }
        return;
      }
      mediaReadyRef.current = false;
      if (readiness === "audio-stalled") {
        setStatus("failed");
        setNotice("Звук не уходит. Урок и материалы сохранены. Подключитесь снова.");
        if (!stalledRef.current) {
          stalledRef.current = true;
          fail({ code: "local_audio", scope: "local", attempt: 1 });
        }
        return;
      }
      if (readiness === "checking-audio") {
        setStatus("checking");
        if (!recoveringRef.current) setNotice("Проверяем передачу звука…");
        return;
      }
      setStatus((prev) => (prev === "reconnecting" || prev === "removed" ? prev : "connecting"));
    };

    const samplePackets = async () => {
      if (!intentRef.current.micOn) {
        packetsRef.current = null;
        return;
      }
      const publication = microphonePublication();
      try {
        const stats = await publication?.track?.getSenderStats?.();
        if (stats && typeof stats.packetsSent === "number") packetsRef.current = stats.packetsSent;
      } catch {
        /* нет отчёта — остаёмся на проверке, тишину собеседника не считаем обрывом */
      }
    };

    const armMediaCheck = ({ reset = false } = {}) => {
      iceRef.current = true;
      if (reset || packetsRef.current == null) {
        packetsRef.current = intentRef.current.micOn ? 0 : null;
        confirmStartedRef.current = Date.now();
        mediaReadyRef.current = false;
      }
      evaluate();
    };

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === ConnectionState.Connected) armMediaCheck();
      else if (state === ConnectionState.Reconnecting) {
        iceRef.current = false;
        mediaReadyRef.current = false;
        setStatus("reconnecting");
        setNotice(MEDIA_RESTORE_NOTICE);
      } else if (state === ConnectionState.Disconnected) {
        iceRef.current = false;
        setStatus("disconnected");
      }
    });
    room.on(RoomEvent.Reconnecting, () => {
      attemptRef.current += 1;
      iceRef.current = false;
      mediaReadyRef.current = false;
      setStatus("reconnecting");
      setNotice(MEDIA_RESTORE_NOTICE);
    });
    room.on(RoomEvent.Reconnected, () => {
      packetsRef.current = null;
      confirmStartedRef.current = 0;
      mediaReadyRef.current = false;
      iceRef.current = false;
      void applyIntent().then(() => {
        refreshTiles();
        armMediaCheck({ reset: true });
      });
    });
    room.on(RoomEvent.ParticipantConnected, refreshTiles);
    room.on(RoomEvent.ParticipantDisconnected, refreshTiles);
    room.on(RoomEvent.TrackSubscribed, refreshTiles);
    room.on(RoomEvent.TrackUnsubscribed, refreshTiles);
    room.on(RoomEvent.LocalTrackPublished, refreshTiles);
    room.on(RoomEvent.LocalTrackUnpublished, refreshTiles);
    room.on(RoomEvent.TrackMuted, refreshTiles);
    room.on(RoomEvent.TrackUnmuted, refreshTiles);
    room.on(RoomEvent.DataReceived || "dataReceived", (payload, participant) => {
      let message = null;
      try {
        message = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        message = null;
      }
      if (!message || typeof message !== "object") return;
      const identity = participant?.identity || "";
      const mine = Boolean(identity && identity === room.localParticipant?.identity);
      if (message.type === "chat") {
        const text = String(message.text || "").trim().slice(0, 500);
        if (!text) return;
        const id = String(message.id || `${Date.now()}-${identity}`);
        setMessages((prev) => {
          if (prev.some((item) => item.id === id)) return prev;
          return [...prev.slice(-99), {
            id,
            author: mine ? "Вы" : (participant?.name || message.from || "Участник"),
            text,
            mine,
          }];
        });
        return;
      }
      if (message.type === "hand" && identity) {
        handsRef.current.set(identity, message.raised === true);
        setHandVersion((value) => value + 1);
        if (mine) setHandRaised(message.raised === true);
      }
    });
    room.on(RoomEvent.ActiveSpeakersChanged || "activeSpeakersChanged", (speakers) => {
      const first = Array.isArray(speakers) ? speakers[0] : null;
      setDominantId(first?.identity || "");
    });
    room.on(RoomEvent.MediaDevicesError, (error) => {
      fail({ code: "device_permission", name: error?.name || "NotAllowedError" });
    });
    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant?.identity !== room.localParticipant.identity) return;
      if (quality !== ConnectionQuality.Poor && quality !== ConnectionQuality.Lost) return;
      if (loweredRef.current || !intentRef.current.camOn) return;
      loweredRef.current = true;
      void room.localParticipant.setCameraEnabled(true, { resolution: VideoPresets.h180.resolution });
    });
    room.on(RoomEvent.Disconnected, (reason) => {
      if (goneRef.current) return;
      iceRef.current = false;
      mediaReadyRef.current = false;
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        setStatus("failed");
        setNotice("Это подключение заменило предыдущую вкладку. Вторая копия участника не создаётся.");
        return;
      }
      if (
        reason === DisconnectReason.PARTICIPANT_REMOVED
        || reason === DisconnectReason.ROOM_DELETED
        || reason === DisconnectReason.ROOM_CLOSED
      ) {
        setStatus("removed");
        setNotice("Видеосвязь закрыта. Урок и материалы доступны.");
        return;
      }
      attemptRef.current += 1;
      const delay = reconnectDelayMs(attemptRef.current);
      const mediaDead = reason === DisconnectReason.MEDIA_FAILURE;
      fail({ code: mediaDead ? "ice_failed" : "livekit_signal", attempt: attemptRef.current });
      setStatus("reconnecting");
      setNotice(MEDIA_RESTORE_NOTICE);
      timer = window.setTimeout(() => {
        if (goneRef.current) return;
        if (attemptRef.current > 3) {
          setStatus("failed");
          setNotice("Видеосвязь не восстановлена. Урок и материалы сохранены. Подключитесь снова.");
          return;
        }
        void (async () => {
          try {
            let nextUrl = url;
            let nextToken = token;
            if (typeof refreshCredentialsRef.current === "function") {
              const fresh = await refreshCredentialsRef.current();
              if (fresh?.url && fresh?.token) {
                nextUrl = fresh.url;
                nextToken = fresh.token;
              }
            }
            await room.connect(nextUrl, nextToken);
            if (goneRef.current) return;
            await applyIntent();
            armMediaCheck({ reset: true });
          } catch (error) {
            fail({ code: "livekit_signal", name: error?.name || "" });
          }
        })();
      }, delay);
    });

    void (async () => {
      try {
        await room.connect(url, token);
        if (goneRef.current) {
          room.disconnect(true);
          return;
        }
        if (displayName) {
          try {
            await room.localParticipant.setName(displayName);
          } catch {
            /* имя на экране необязательно для связи */
          }
        }
        await applyIntent();
        armMediaCheck({ reset: true });
        refreshTiles();
        sampler = window.setInterval(() => {
          void samplePackets().then(evaluate);
        }, 1000);
      } catch (error) {
        if (goneRef.current) return;
        setStatus("failed");
        fail({ code: "livekit_signal", name: error?.name || "" });
      }
    })();

    return () => {
      goneRef.current = true;
      window.clearTimeout(timer);
      window.clearInterval(sampler);
      try {
        room.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        room.disconnect(true);
      } catch {
        /* ignore */
      }
      roomRef.current = null;
    };
    // Намерение микрофона хранится в ref и не пересоздаёт комнату.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token, retryTick]);

  const publishSignal = async (payload) => {
    const participant = roomRef.current?.localParticipant;
    if (typeof participant?.publishData !== "function") return false;
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    await participant.publishData(bytes, { reliable: true, topic: "itflux" });
    return true;
  };

  const toggleMic = async () => {
    const next = !intentRef.current.micOn;
    intentRef.current = { ...intentRef.current, micOn: next };
    setMicOn(next);
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
      refreshTiles();
    } catch (error) {
      intentRef.current = { ...intentRef.current, micOn: !next };
      setMicOn(!next);
      onFault?.({ code: "device_permission", name: error?.name || "NotAllowedError", attempt: 1 });
    }
  };

  const toggleCam = async () => {
    const next = !intentRef.current.camOn;
    intentRef.current = { ...intentRef.current, camOn: next };
    setCamOn(next);
    setAudioOnly(false);
    audioOnlyRef.current = false;
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(next);
      refreshTiles();
    } catch (error) {
      intentRef.current = { ...intentRef.current, camOn: !next };
      setCamOn(!next);
      onFault?.({ code: "device_permission", name: error?.name || "NotAllowedError", attempt: 1 });
    }
  };

  const toggleShare = async () => {
    if (busy === "share") return;
    const next = !sharing;
    setBusy("share");
    try {
      await roomRef.current?.localParticipant.setScreenShareEnabled(next, next ? SCREEN_SHARE_CAPTURE : undefined);
      setSharing(next);
      if (!next) setNotice(MEDIA_SCREEN_NOTE);
      refreshTiles();
    } catch (error) {
      if (error?.name !== "NotAllowedError") {
        setNotice("Демонстрацию экрана не удалось запустить. Её можно включить ещё раз.");
      }
    } finally {
      setBusy("");
    }
  };

  const toggleHand = async () => {
    const next = !handRaisedRef.current;
    handRaisedRef.current = next;
    setHandRaised(next);
    const identity = roomRef.current?.localParticipant?.identity;
    if (identity) {
      handsRef.current.set(identity, next);
      setHandVersion((value) => value + 1);
    }
    try {
      await publishSignal({ type: "hand", raised: next });
    } catch {
      setNotice("Поднять руку сейчас не удалось.");
    }
  };

  const toggleLayout = () => setTileWide((value) => !value);

  const loadDevices = async () => {
    try {
      const [audioInput, audioOutput, videoInput] = await Promise.all([
        Room.getLocalDevices("audioinput"),
        Room.getLocalDevices("audiooutput"),
        Room.getLocalDevices("videoinput"),
      ]);
      return {
        audioInput: mapDevices(audioInput),
        audioOutput: mapDevices(audioOutput),
        videoInput: mapDevices(videoInput),
      };
    } catch {
      return null;
    }
  };

  const selectDevice = async (kind, device) => {
    const deviceId = device?.deviceId || device;
    const liveKitKind = DEVICE_KIND[kind] || kind;
    if (!deviceId || !liveKitKind) return;
    try {
      await roomRef.current?.switchActiveDevice(liveKitKind, deviceId);
    } catch {
      setNotice("Это устройство выбрать не удалось.");
    }
  };

  const sendChat = async (text) => {
    const body = String(text || "").trim().slice(0, 500);
    if (!body) return;
    const id = `${Date.now()}-local`;
    setMessages((prev) => [...prev.slice(-99), { id, author: "Вы", text: body, mine: true }]);
    try {
      await publishSignal({ type: "chat", id, text: body, from: displayName || "Вы" });
    } catch {
      setNotice("Чат конференции сейчас недоступен.");
    }
  };

  const hangup = () => {
    try {
      roomRef.current?.disconnect?.(true);
    } catch {
      /* комната уже закрыта */
    }
    onLeaveRef.current?.();
  };

  const startAudio = async () => {
    try {
      await roomRef.current?.startAudio?.();
    } catch {
      setNotice("Звук не включился. Нажмите ещё раз.");
    }
  };

  const retry = () => setRetryTick((value) => value + 1);

  const removeRemote = async (identity) => {
    if (!canModerate) return;
    const match = /^p(\d+)$/.exec(String(identity || ""));
    if (!match) return;
    setBusy(identity);
    try {
      const result = await disconnectVideoMeetingParticipant(meetingUuid, { userId: Number(match[1]) });
      if (result && result.removed === false) {
        setNotice(result.rejoinBlocked
          ? "Повторный вход закрыт. Мгновенно оборвать текущее соединение сервер медиа не подтвердил."
          : "Сервер медиа не подтвердил отключение. Повторите действие.");
      }
    } catch {
      setNotice("Не удалось отключить участника.");
    } finally {
      setBusy("");
    }
  };

  const releaseMedia = async () => {
    goneRef.current = true;
    const room = roomRef.current;
    if (!room) return;
    try {
      room.removeAllListeners();
    } catch {
      /* ignore */
    }
    try {
      await room.disconnect(true);
    } catch {
      /* старая сессия уже могла завершиться */
    }
  };

  actionsRef.current = {
    toggleMic,
    toggleCam,
    toggleShare,
    toggleHand,
    toggleLayout,
    loadDevices,
    selectDevice,
    sendChat,
    hangup,
    startAudio,
    retry,
    removeRemote,
    releaseMedia,
    getPipMedia: () => pickPipMedia(roomRef.current, { dominantId, micOn, camOn }),
  };
  useImperativeHandle(ref, () => ({
    toggleMic: () => actionsRef.current.toggleMic(),
    toggleCam: () => actionsRef.current.toggleCam(),
    toggleShare: () => actionsRef.current.toggleShare(),
    toggleHand: () => actionsRef.current.toggleHand(),
    toggleLayout: () => actionsRef.current.toggleLayout(),
    loadDevices: () => actionsRef.current.loadDevices(),
    selectDevice: (kind, device) => actionsRef.current.selectDevice(kind, device),
    sendChat: (text) => actionsRef.current.sendChat(text),
    hangup: () => actionsRef.current.hangup(),
    startAudio: () => actionsRef.current.startAudio(),
    retry: () => actionsRef.current.retry(),
    removeRemote: (identity) => actionsRef.current.removeRemote(identity),
    releaseMedia: () => actionsRef.current.releaseMedia(),
    getPipMedia: () => actionsRef.current.getPipMedia(),
  }), []);

  const conferenceStatus = liveKitConferenceStatus(status, notice);
  const localPerson = {
    id: roomRef.current?.localParticipant?.identity || "local",
    displayName: roomRef.current?.localParticipant?.name || displayName || "Вы",
    audioMuted: !micOn,
    roleLabel: handRaised ? "Рука поднята" : "",
  };
  const remotePeople = remotes.map((person) => ({
    id: person.identity,
    displayName: person.name,
    audioMuted: person.audioMuted === true,
    roleLabel: handsRef.current.get(person.identity) ? "Рука поднята" : "Участник",
  }));

  useEffect(() => {
    onStateChangeRef.current?.({
      micOn,
      camOn,
      sharing,
      handRaised,
      tileWide,
      ready: conferenceStatus.ready,
      statusPhase: conferenceStatus.phase,
      statusTitle: conferenceStatus.title,
      showReconnect: conferenceStatus.showReconnect,
      local: localPerson,
      remotes: remotePeople,
      messages,
      dominantId,
      participantCount: 1 + remotePeople.length,
    });
    // Список участников собирается из полей выше. Сам объект каждый рендер новый.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    micOn,
    camOn,
    sharing,
    handRaised,
    tileWide,
    status,
    notice,
    messages,
    remotes,
    dominantId,
    handVersion,
    displayName,
    conferenceStatus.ready,
    conferenceStatus.phase,
    conferenceStatus.title,
    conferenceStatus.showReconnect,
  ]);

  useEffect(() => {
    if (!controls) return undefined;
    if (sideTab === "chat") setUnreadChat(0);
    return undefined;
  }, [controls, sideTab]);

  const seenMessagesRef = useRef(0);
  useEffect(() => {
    if (!controls) {
      seenMessagesRef.current = messages.length;
      return;
    }
    const previous = seenMessagesRef.current;
    seenMessagesRef.current = messages.length;
    if (messages.length <= previous || sideTabRef.current === "chat") return;
    const added = messages.slice(previous).filter((item) => !item.mine).length;
    if (added) setUnreadChat((count) => count + added);
  }, [controls, messages]);

  return (
    <div className="lk-call">
      <section className="lk-fallback" aria-label="Видеосвязь">
        <div className={`lk-fallback-stage${tileWide ? " lk-fallback-stage--tiles" : ""}`}>
          {tiles.length ? tiles.map((tile) => (
            <MediaTile key={tile.key} track={tile.track} label={tile.label} muted={tile.muted} avatar={tile.avatar} pipRole={tile.pipRole} screen={tile.screen} />
          )) : conferenceStatus.ready ? (
            <p className="lk-fallback-wait">Камера выключена. Голос можно оставить включённым.</p>
          ) : null}
          {audios.map((item) => (
            <MediaTile key={item.key} track={item.track} audio />
          ))}
        </div>
      </section>
      {controls ? (
        <ConferenceControls
          disabled={!conferenceStatus.ready}
          micOn={micOn}
          camOn={camOn}
          sharing={sharing}
          handRaised={handRaised}
          tileWide={tileWide}
          peopleOpen={sideTab === "people"}
          chatOpen={sideTab === "chat"}
          participantCount={1 + remotePeople.length}
          unreadChat={unreadChat}
          statusPhase={conferenceStatus.phase}
          statusTitle={conferenceStatus.title}
          screenShareAvailable={screenShareSupported()}
          showReconnect={conferenceStatus.showReconnect}
          onToggleMic={() => { void toggleMic(); }}
          onToggleCam={() => { void toggleCam(); }}
          onToggleShare={() => { void toggleShare(); }}
          onToggleHand={() => { void toggleHand(); }}
          onToggleLayout={toggleLayout}
          onTogglePeople={() => setSideTab((current) => (current === "people" ? "" : "people"))}
          onToggleChat={() => setSideTab((current) => (current === "chat" ? "" : "chat"))}
          onHangup={hangup}
          onEnableSound={() => { void startAudio(); }}
          onLoadDevices={loadDevices}
          onSelectDevice={(kind, device) => { void selectDevice(kind, device); }}
          onReconnect={retry}
        />
      ) : null}
      {controls ? (
        <ConferenceSide
          open={Boolean(sideTab)}
          tab={sideTab === "chat" ? "chat" : "people"}
          local={localPerson}
          remotes={remotePeople}
          dominantId={dominantId}
          messages={messages}
          onTab={setSideTab}
          onClose={() => setSideTab("")}
          onSend={(text) => { void sendChat(text); }}
        />
      ) : null}
    </div>
  );
});

export default LiveKitCallView;
