import { useCallback, useEffect, useRef, useState } from "react";
import CabinetModal from "../components/CabinetModal";
import { probeJitsiInfrastructure, abortJitsiConnectionProbe } from "./jitsiProbe";
import { probeConnectionQuality } from "./connectionProbe";
import {
  attachVideoPreview,
  awaitPrimedMedia,
  clearPrimedMedia,
  createMicMeter,
  describeMediaError,
  detachVideoPreview,
  listMediaDevices,
  playTestTone,
  primeConnectionCheckMedia,
  requestMedia,
} from "./mediaDevices";
import { replaceTrackedStream, stopAllConnectionCheckStreams, stopMediaStream } from "./mediaCleanup";
import { isSecureMediaContext, mapMediaError, mediaApiSupported } from "./mediaErrors";
import { writeConnectionCheckResult } from "./storage";
import "./connectionCheck.css";

const STEPS = ["camera", "microphone", "speaker", "connection", "jitsi", "summary"];
const STEP_LABELS = {
  camera: "Камера",
  microphone: "Микрофон",
  speaker: "Звук",
  connection: "Интернет",
  jitsi: "Комната урока",
  summary: "Итог",
};

const EMPTY_ITEM = { status: "idle", label: "", message: "" };

function statusClass(status) {
  if (status === "ok" || status === "good") return "ok";
  if (status === "fair" || status === "warn") return "warn";
  if (status === "fail" || status === "poor") return "fail";
  return "";
}

function summaryValue(item, fallback) {
  if (item.status === "ok" || item.status === "good") return item.label || fallback;
  if (item.status === "fair") return item.label || "Возможны небольшие задержки";
  if (item.status === "idle") return "Не проверялось";
  return item.label || "Есть проблема";
}

export default function ConnectionCheckModal({
  open,
  onClose,
  canJoin = false,
  joinLabel = "Перейти в урок",
  onJoin,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const meterRef = useRef(null);
  const [step, setStep] = useState("camera");
  const [busy, setBusy] = useState(false);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [micDevices, setMicDevices] = useState([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [heardPeak, setHeardPeak] = useState(false);
  const [camera, setCamera] = useState(EMPTY_ITEM);
  const [microphone, setMicrophone] = useState(EMPTY_ITEM);
  const [speaker, setSpeaker] = useState(EMPTY_ITEM);
  const [connection, setConnection] = useState(EMPTY_ITEM);
  const [jitsi, setJitsi] = useState(EMPTY_ITEM);

  const cleanupMedia = useCallback(() => {
    abortJitsiConnectionProbe();
    meterRef.current?.stop?.();
    meterRef.current = null;
    detachVideoPreview(videoRef.current);
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    clearPrimedMedia();
    stopAllConnectionCheckStreams();
  }, []);

  const resetState = useCallback(() => {
    setStep("camera");
    setBusy(false);
    setCamera(EMPTY_ITEM);
    setMicrophone(EMPTY_ITEM);
    setSpeaker(EMPTY_ITEM);
    setConnection(EMPTY_ITEM);
    setJitsi(EMPTY_ITEM);
    setMicLevel(0);
    setHeardPeak(false);
    setCameraId("");
    setMicId("");
  }, []);

  const closeAndCleanup = useCallback(() => {
    cleanupMedia();
    resetState();
    onClose?.();
  }, [cleanupMedia, onClose, resetState]);

  useEffect(() => {
    if (!open) return undefined;
    const onPageHide = () => cleanupMedia();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      cleanupMedia();
    };
  }, [open, cleanupMedia]);

  const refreshDevices = useCallback(async () => {
    try {
      const { cameras, microphones } = await listMediaDevices();
      setCameraDevices(cameras);
      setMicDevices(microphones);
      return { cameras, microphones };
    } catch {
      return { cameras: [], microphones: [] };
    }
  }, []);

  const startCamera = useCallback(async (nextCameraId = cameraId) => {
    setBusy(true);
    setCamera({ status: "checking", label: "Проверяем камеру…", message: "" });
    try {
      if (!mediaApiSupported()) {
        throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
      }
      if (!isSecureMediaContext()) {
        const mapped = mapMediaError({ name: "SecurityError" }, "camera");
        setCamera({ status: "fail", label: mapped.title, message: mapped.message });
        return;
      }
      const primed = await awaitPrimedMedia();
      let stream = primed.stream;
      if (!stream) {
        if (primed.error && !nextCameraId) {
          throw primed.error;
        }
        stream = await requestMedia({
          video: true,
          audio: true,
          videoDeviceId: nextCameraId || undefined,
          audioDeviceId: micId || undefined,
        });
      }
      streamRef.current = replaceTrackedStream(streamRef.current, stream);
      await refreshDevices();
      const hasVideo = stream.getVideoTracks().some((track) => track.readyState === "live");
      if (!hasVideo) {
        const mapped = mapMediaError({ name: "NotFoundError" }, "camera");
        setCamera({ status: "fail", label: mapped.title, message: mapped.message });
        return;
      }
      setCamera({ status: "ok", label: "Камера работает", message: "" });
    } catch (error) {
      const mapped = describeMediaError(error, "camera");
      setCamera({ status: "fail", label: mapped.title, message: mapped.message });
    } finally {
      setBusy(false);
    }
  }, [cameraId, micId, refreshDevices]);

  const startMicrophone = useCallback(async (nextMicId = micId) => {
    setBusy(true);
    setMicrophone({ status: "checking", label: "Проверяем микрофон…", message: "" });
    setHeardPeak(false);
    meterRef.current?.stop?.();
    try {
      let stream = streamRef.current;
      const liveAudio = stream?.getAudioTracks?.().some((track) => track.readyState === "live");
      if (!liveAudio || nextMicId) {
        const next = await requestMedia({
          video: Boolean(stream?.getVideoTracks?.().length),
          audio: true,
          videoDeviceId: cameraId || undefined,
          audioDeviceId: nextMicId || undefined,
        });
        if (stream && stream !== next) {
          next.getVideoTracks().forEach((track) => {
            if (track.readyState !== "live" && stream.getVideoTracks()[0]) {
              /* keep existing preview if new stream has no video */
            }
          });
        }
        streamRef.current = replaceTrackedStream(streamRef.current, next);
        stream = next;
      }
      await refreshDevices();
      if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
        const mapped = mapMediaError({ name: "NotFoundError" }, "microphone");
        setMicrophone({ status: "fail", label: mapped.title, message: mapped.message });
        return;
      }
      meterRef.current = createMicMeter(stream, (level) => {
        setMicLevel(level);
        if (level > 0.04) setHeardPeak(true);
      });
      setMicrophone({
        status: "ok",
        label: "Говорите несколько слов — индикатор должен двигаться",
        message: "",
      });
    } catch (error) {
      const mapped = describeMediaError(error, "microphone");
      setMicrophone({ status: "fail", label: mapped.title, message: mapped.message });
    } finally {
      setBusy(false);
    }
  }, [cameraId, micId, refreshDevices]);

  const startJitsi = useCallback(async () => {
    cleanupMedia();
    setBusy(true);
    setJitsi({ status: "checking", label: "Проверяем комнату урока…", message: "" });
    try {
      const result = await probeJitsiInfrastructure();
      if (result?.aborted) return;
      setJitsi({
        status: result.status === "ok" ? "ok" : result.status,
        label: result.label,
        message: result.message,
      });
    } catch {
      setJitsi({
        status: "fail",
        label: "Не удалось подключиться к серверу видеосвязи",
        message: "Повторите проверку. Если ошибка повторяется, обновите страницу.",
      });
    } finally {
      setBusy(false);
    }
  }, [cleanupMedia]);

  const startConnection = useCallback(async () => {
    setBusy(true);
    setConnection({ status: "checking", label: "Проверяем соединение…", message: "" });
    try {
      const result = await probeConnectionQuality();
      setConnection({
        status: result.status,
        label: result.label,
        message: result.detail,
      });
    } catch {
      setConnection({
        status: "poor",
        label: "Соединение нестабильно",
        message: "Не удалось завершить проверку интернета. Повторите попытку.",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    if (step === "camera") {
      void startCamera();
    }
    if (step === "microphone") {
      void startMicrophone();
    }
    if (step === "speaker") {
      meterRef.current?.stop?.();
      meterRef.current = null;
      detachVideoPreview(videoRef.current);
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    if (step === "connection") {
      void startConnection();
    }
    if (step === "jitsi") {
      void startJitsi();
    }
    if (step === "summary") {
      cleanupMedia();
      writeConnectionCheckResult({
        camera: camera.status === "ok" ? "ok" : "fail",
        microphone: microphone.status === "ok" ? "ok" : "fail",
        speaker: speaker.status === "ok" ? "ok" : "fail",
        connection: connection.status || "unknown",
        jitsi: jitsi.status || "unknown",
      });
    }
    return undefined;
    // Запуск шага — только при смене step/open, не при каждом обновлении статусов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  useEffect(() => {
    if (!open || (step !== "camera" && step !== "microphone")) return;
    if (streamRef.current && videoRef.current) {
      attachVideoPreview(videoRef.current, streamRef.current);
    }
  }, [open, step, camera.status, microphone.status]);

  useEffect(() => {
    if (step === "microphone" && heardPeak && microphone.status === "ok") {
      setMicrophone((prev) => (
        prev.label === "Микрофон работает"
          ? prev
          : { ...prev, label: "Микрофон работает" }
      ));
    }
  }, [heardPeak, microphone.status, step]);

  const goNext = () => {
    if (step === "microphone" && !heardPeak && microphone.status !== "fail") {
      setMicrophone({
        status: "fail",
        label: "Микрофон не среагировал",
        message: "Индикатор не двигался. Проверьте, что выбран нужный микрофон и он не выключен.",
      });
    }
    const index = STEPS.indexOf(step);
    if (index < STEPS.length - 1) setStep(STEPS[index + 1]);
  };

  const restart = () => {
    cleanupMedia();
    void primeConnectionCheckMedia();
    resetState();
  };

  const handleJoin = () => {
    cleanupMedia();
    const join = onJoin;
    resetState();
    onClose?.();
    join?.();
  };

  if (!open) return null;

  const currentIndex = STEPS.indexOf(step);
  const footer = (
    <div className="cc-actions">
      {step !== "summary" ? (
        <button type="button" className="cb-btn cb-btn--ghost" onClick={closeAndCleanup}>
          Закрыть
        </button>
      ) : null}
      {step === "camera" ? (
        <>
          {camera.status === "fail" ? (
            <button type="button" className="cb-btn cb-btn--outline" disabled={busy} onClick={() => void startCamera()}>
              Повторить
            </button>
          ) : null}
          <button type="button" className="cb-btn cb-btn--primary" disabled={busy} onClick={goNext}>
            Далее
          </button>
        </>
      ) : null}
      {step === "microphone" ? (
        <button type="button" className="cb-btn cb-btn--primary" disabled={busy} onClick={goNext}>
          Далее
        </button>
      ) : null}
      {step === "speaker" && speaker.status !== "idle" ? (
        <button type="button" className="cb-btn cb-btn--primary" onClick={goNext}>
          Далее
        </button>
      ) : null}
      {step === "connection" ? (
        <button
          type="button"
          className="cb-btn cb-btn--primary"
          disabled={busy || connection.status === "checking" || connection.status === "idle"}
          onClick={goNext}
        >
          Далее
        </button>
      ) : null}
      {step === "jitsi" ? (
        <>
          {jitsi.status === "fail" ? (
            <button type="button" className="cb-btn cb-btn--outline" disabled={busy} onClick={() => void startJitsi()}>
              Повторить
            </button>
          ) : null}
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            disabled={busy || jitsi.status === "checking" || jitsi.status === "idle"}
            onClick={goNext}
          >
            К итогам
          </button>
        </>
      ) : null}
      {step === "summary" ? (
        <>
          <button type="button" className="cb-btn cb-btn--outline" onClick={restart}>
            Проверить ещё раз
          </button>
          {canJoin ? (
            <button type="button" className="cb-btn cb-btn--primary" onClick={handleJoin}>
              {joinLabel}
            </button>
          ) : (
            <button type="button" className="cb-btn cb-btn--primary" onClick={closeAndCleanup}>
              Готово
            </button>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <CabinetModal
      title="Проверяем связь перед уроком"
      onClose={closeAndCleanup}
      footer={footer}
    >
      <ol className="cc-stepper" aria-hidden="true">
        {STEPS.map((id, index) => (
          <li
            key={id}
            className={`cc-stepper__item${index < currentIndex ? " is-done" : ""}${index === currentIndex ? " is-current" : ""}`}
          />
        ))}
      </ol>

      {step === "camera" ? (
        <>
          <p className="cc-lead">
            {STEP_LABELS.camera}: разрешите доступ, когда браузер спросит, и проверьте своё изображение.
          </p>
          <div className="cc-preview">
            <video ref={videoRef} autoPlay muted playsInline />
            {camera.status !== "ok" ? (
              <div className="cc-preview__placeholder">
                {busy ? "Включаем камеру…" : "Изображение появится после разрешения доступа"}
              </div>
            ) : null}
          </div>
          {cameraDevices.length > 1 ? (
            <label className="cc-field">
              <span>Камера</span>
              <select
                value={cameraId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setCameraId(nextId);
                  void startCamera(nextId);
                }}
              >
                <option value="">Камера по умолчанию</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Камера ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {camera.status === "ok" ? (
            <div className="cc-status cc-status--ok"><strong>Камера работает ✓</strong></div>
          ) : camera.status === "fail" ? (
            <div className="cc-status cc-status--fail">
              <div>
                <strong>{camera.label}</strong>
                {camera.message}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {step === "microphone" ? (
        <>
          <p className="cc-lead">Скажите несколько слов. Индикатор должен реагировать на голос.</p>
          <div className="cc-meter" aria-live="polite">
            <div className="cc-meter__bar">
              <div className="cc-meter__fill" style={{ width: `${Math.min(100, Math.round(micLevel * 280))}%` }} />
            </div>
            <span className="cc-meter__label">{heardPeak ? "Есть звук" : "Говорите"}</span>
          </div>
          {micDevices.length > 1 ? (
            <label className="cc-field">
              <span>Микрофон</span>
              <select
                value={micId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setMicId(nextId);
                  void startMicrophone(nextId);
                }}
              >
                <option value="">Микрофон по умолчанию</option>
                {micDevices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Микрофон ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {microphone.status === "fail" ? (
            <div className="cc-status cc-status--fail">
              <div>
                <strong>{microphone.label}</strong>
                {microphone.message}
              </div>
            </div>
          ) : heardPeak ? (
            <div className="cc-status cc-status--ok"><strong>Микрофон работает ✓</strong></div>
          ) : microphone.status === "ok" ? (
            <p className="cc-hint">Если индикатор не двигается, проверьте, что выбран нужный микрофон и он не выключен.</p>
          ) : null}
        </>
      ) : null}

      {step === "speaker" ? (
        <>
          <p className="cc-lead">Включим короткий тестовый звук. Подтвердите, если его слышно.</p>
          <div className="cc-actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="cb-btn cb-btn--outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await playTestTone();
                  if (speaker.status === "idle") {
                    setSpeaker({ status: "warn", label: "Звук воспроизведён — подтвердите, если слышите", message: "" });
                  }
                } catch {
                  setSpeaker({
                    status: "fail",
                    label: "Не удалось воспроизвести звук",
                    message: "Проверьте динамик или наушники и громкость устройства.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Воспроизвести тестовый звук
            </button>
          </div>
          <div className="cc-actions">
            <button
              type="button"
              className="cb-btn cb-btn--primary"
              onClick={() => setSpeaker({ status: "ok", label: "Динамики работают", message: "" })}
            >
              Я слышу звук
            </button>
            <button
              type="button"
              className="cb-btn cb-btn--outline"
              onClick={() => setSpeaker({
                status: "fail",
                label: "Звук не слышен",
                message: "Проверьте громкость, не включён ли беззвучный режим, и что выбран правильный динамик или наушники.",
              })}
            >
              Не слышу
            </button>
          </div>
          {speaker.status === "ok" ? (
            <div className="cc-status cc-status--ok" style={{ marginTop: 12 }}><strong>Динамики работают ✓</strong></div>
          ) : speaker.status === "fail" ? (
            <div className="cc-status cc-status--fail" style={{ marginTop: 12 }}>
              <div>
                <strong>{speaker.label}</strong>
                {speaker.message}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {step === "connection" ? (
        <>
          <p className="cc-lead">Проверяем устойчивость связи с платформой. Это не тест скорости.</p>
          {connection.status === "checking" || connection.status === "idle" ? (
            <p className="cc-hint">Идёт проверка…</p>
          ) : (
            <div className={`cc-status cc-status--${statusClass(connection.status)}`}>
              <div>
                <strong>{connection.label}{connection.status === "good" ? " ✓" : ""}</strong>
                {connection.message}
              </div>
            </div>
          )}
        </>
      ) : null}

      {step === "jitsi" ? (
        <>
          <p className="cc-lead">Проверяем, открывается ли комната урока на сервере видеосвязи.</p>
          {jitsi.status === "checking" || jitsi.status === "idle" ? (
            <p className="cc-hint">Загружаем комнату урока… Это может занять до 15 секунд.</p>
          ) : (
            <div className={`cc-status cc-status--${statusClass(jitsi.status)}`}>
              <div>
                <strong>{jitsi.label}{jitsi.status === "ok" ? " ✓" : ""}</strong>
                {jitsi.message}
              </div>
            </div>
          )}
        </>
      ) : null}

      {step === "summary" ? (
        <>
          <p className="cc-lead">
            {camera.status === "ok" && microphone.status === "ok" && speaker.status === "ok"
              && (connection.status === "good" || connection.status === "fair")
              && (jitsi.status === "ok" || jitsi.status === "fair")
              ? "Всё готово к уроку"
              : "Проверка завершена. Можно подключаться, даже если что-то не сработало."}
          </p>
          <div className="cc-summary">
            {[
              ["Камера", camera, "Камера работает ✓"],
              ["Микрофон", microphone, "Микрофон работает ✓"],
              ["Звук", speaker, "Динамики работают ✓"],
              ["Интернет", connection, "Соединение хорошее ✓"],
              ["Комната урока", jitsi, "Комната урока загружается быстро ✓"],
            ].map(([name, item, okLabel]) => (
              <div key={name} className={`cc-summary__row is-${statusClass(item.status) || "warn"}`}>
                <span className="cc-summary__name">{name}</span>
                <span className="cc-summary__value">{summaryValue(item, okLabel)}</span>
              </div>
            ))}
          </div>
          {camera.status !== "ok" || microphone.status !== "ok" || speaker.status !== "ok" || connection.status === "poor" || jitsi.status === "fail" ? (
            <p className="cc-hint">
              {[
                camera.status !== "ok" ? camera.message || "Проверьте камеру в настройках сайта." : "",
                microphone.status !== "ok" ? microphone.message || "Проверьте микрофон в настройках сайта." : "",
                speaker.status !== "ok" ? speaker.message : "",
                connection.status === "poor" ? connection.message : "",
                jitsi.status === "fail" ? jitsi.message : "",
              ].filter(Boolean).join(" ")}
            </p>
          ) : (
            <p className="cc-hint">Результат сохранён только на этом устройстве и не гарантирует качество звонка.</p>
          )}
          {canJoin ? null : (
            <p className="cc-hint">Когда учитель откроет комнату, подключайтесь кнопкой урока — как обычно.</p>
          )}
        </>
      ) : null}

    </CabinetModal>
  );
}
