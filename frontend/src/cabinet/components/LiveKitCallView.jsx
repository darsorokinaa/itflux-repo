import { useEffect, useRef, useState } from "react";
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

function MediaTile({ track, muted = false, label, audio = false }) {
  const ref = useAttachedTrack(track);
  if (audio) {
    return <audio ref={ref} autoPlay playsInline />;
  }
  return (
    <figure className="lk-fallback-tile">
      <video ref={ref} autoPlay playsInline muted={muted} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

const AUDIO_CONFIRM_MS = 8000;

export function collectTiles(room, { audioOnly }) {
  const tiles = [];
  const audios = [];
  const local = room?.localParticipant;
  if (local) {
    const camera = local.getTrackPublication?.(Track.Source.Camera)?.track;
    const screen = local.getTrackPublication?.(Track.Source.ScreenShare)?.track;
    if (camera && !audioOnly) {
      tiles.push({ key: "local-camera", track: camera, label: local.name || "Вы", muted: true });
    }
    if (screen && !audioOnly) {
      tiles.push({ key: "local-screen", track: screen, label: "Ваш экран", muted: true });
    }
    // Свой микрофон в <audio> не вставляем: браузер проигрывает его обратно.
  }
  room?.remoteParticipants?.forEach?.((participant) => {
    const camera = participant.getTrackPublication?.(Track.Source.Camera)?.track;
    const mic = participant.getTrackPublication?.(Track.Source.Microphone)?.track;
    const screen = participant.getTrackPublication?.(Track.Source.ScreenShare)?.track;
    const label = participant.name || "Участник";
    if (camera && !audioOnly) tiles.push({ key: `${participant.identity}-camera`, track: camera, label, muted: false });
    if (screen && !audioOnly) tiles.push({ key: `${participant.identity}-screen`, track: screen, label: `${label}: экран`, muted: false });
    if (mic) audios.push({ key: `${participant.identity}-mic`, track: mic });
  });
  return { tiles, audios };
}

export default function LiveKitCallView({
  meetingUuid,
  url,
  token,
  canModerate = false,
  displayName = "",
  startWithAudioMuted = false,
  startWithVideoMuted = false,
  recovering = false,
  refreshCredentials,
  onConnected,
  onParticipants,
  onFault,
  onLeave,
}) {
  const roomRef = useRef(null);
  const intentRef = useRef({ micOn: !startWithAudioMuted, camOn: !startWithVideoMuted, screenSharing: false });
  const attemptRef = useRef(0);
  const goneRef = useRef(false);
  const audioOnlyRef = useRef(false);
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
  const [audioOnly, setAudioOnly] = useState(false);
  const [devices, setDevices] = useState({ audio: [], video: [] });
  const [micOn, setMicOn] = useState(!startWithAudioMuted);
  const [camOn, setCamOn] = useState(!startWithVideoMuted);
  const [sharing, setSharing] = useState(false);
  const [remotes, setRemotes] = useState([]);
  const [busy, setBusy] = useState("");

  const refreshTiles = (audioOnlyOverride = audioOnly) => {
    const room = roomRef.current;
    if (!room) return;
    const next = collectTiles(room, { audioOnly: audioOnlyOverride });
    setTiles(next.tiles);
    setAudios(next.audios);
    const people = [];
    room.remoteParticipants?.forEach?.((participant) => {
      people.push({
        identity: participant.identity,
        name: participant.name || "Участник",
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
        try {
          const audio = await Room.getLocalDevices("audioinput");
          const video = await Room.getLocalDevices("videoinput");
          if (!goneRef.current) setDevices({ audio: audio || [], video: video || [] });
        } catch {
          /* список устройств недоступен в этом браузере */
        }
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
  }, [url, token]);

  const toggleMic = async () => {
    const next = !intentRef.current.micOn;
    intentRef.current = { ...intentRef.current, micOn: next };
    setMicOn(next);
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
    } catch (error) {
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
      onFault?.({ code: "device_permission", name: error?.name || "NotAllowedError", attempt: 1 });
    }
  };

  const toggleShare = async () => {
    const next = !sharing;
    setBusy("share");
    try {
      await roomRef.current?.localParticipant.setScreenShareEnabled(next);
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

  const enableAudioOnly = async () => {
    setAudioOnly(true);
    audioOnlyRef.current = true;
    intentRef.current = { ...intentRef.current, camOn: false };
    setCamOn(false);
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(false);
      roomRef.current?.remoteParticipants?.forEach?.((participant) => {
        participant.trackPublications?.forEach?.((publication) => {
          if (publication.kind === Track.Kind.Video) publication.setSubscribed(false);
        });
      });
      refreshTiles(true);
    } catch {
      /* звук остаётся, даже если видео уже выключено */
    }
  };

  const selectDevice = async (kind, deviceId) => {
    if (!deviceId) return;
    try {
      await roomRef.current?.switchActiveDevice(kind, deviceId);
    } catch {
      setNotice("Это устройство выбрать не удалось.");
    }
  };

  const removeRemote = async (identity) => {
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

  const statusLabel = {
    connecting: "Подключаем видеосвязь…",
    checking: "Проверяем передачу звука…",
    connected: "Видеосвязь подключена",
    reconnecting: "Восстанавливаем видеосвязь. Урок и материалы сохранены",
    disconnected: "Видеосвязь прервана",
    failed: "Не удалось подключить видеосвязь",
    removed: "Видеосвязь отключена",
  }[status] || "Видеосвязь";

  return (
    <section className="lk-fallback" aria-label="Видеосвязь">
      <p className={`lk-fallback-status lk-fallback-status--${status}`} role="status">{statusLabel}</p>
      {notice ? <p className="lk-fallback-notice" role="status">{notice}</p> : null}
      {recovering ? <p className="lk-fallback-notice">{MEDIA_SCREEN_NOTE}</p> : null}
      <div className="lk-fallback-stage">
        {tiles.length ? tiles.map((tile) => (
          <MediaTile key={tile.key} track={tile.track} label={tile.label} muted={tile.muted} />
        )) : <p className="lk-fallback-wait">Камера выключена. Голос можно оставить включённым.</p>}
        {audios.map((item) => (
          <MediaTile key={item.key} track={item.track} audio />
        ))}
      </div>
      <div className="lk-fallback-controls">
        <button type="button" onClick={toggleMic} aria-pressed={!micOn}>{micOn ? "Выключить микрофон" : "Включить микрофон"}</button>
        <button type="button" onClick={toggleCam} aria-pressed={!camOn}>{camOn ? "Выключить камеру" : "Включить камеру"}</button>
        <button type="button" onClick={toggleShare} disabled={busy === "share"}>{sharing ? "Остановить демонстрацию" : "Демонстрация экрана"}</button>
        <button type="button" onClick={enableAudioOnly}>Только звук</button>
        <button type="button" onClick={onLeave}>Завершить участие</button>
      </div>
      <div className="lk-fallback-devices">
        <label>
          Микрофон
          <select onChange={(event) => selectDevice("audioinput", event.target.value)} defaultValue="">
            <option value="">Системный</option>
            {devices.audio.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label || "Микрофон"}</option>
            ))}
          </select>
        </label>
        <label>
          Камера
          <select onChange={(event) => selectDevice("videoinput", event.target.value)} defaultValue="">
            <option value="">Системная</option>
            {devices.video.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label || "Камера"}</option>
            ))}
          </select>
        </label>
      </div>
      {canModerate && remotes.length ? (
        <ul className="lk-fallback-people">
          {remotes.map((person) => (
            <li key={person.identity}>
              <span>{person.name}</span>
              <button type="button" onClick={() => removeRemote(person.identity)} disabled={busy === person.identity}>
                Отключить
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
