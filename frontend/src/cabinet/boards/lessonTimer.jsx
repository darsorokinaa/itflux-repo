import { Component, useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { useEditor, useValue } from "tldraw";

/* itflux r29: общий таймер урока — хранится в document meta, синхронизируется tldraw sync */
const KEY = "lessonTimer";

export function readLessonTimer(editor) {
  try {
    const t = editor.getDocumentSettings()?.meta?.[KEY];
    return t && typeof t === "object" ? t : null;
  } catch { return null; }
}

function writeLessonTimer(editor, value) {
  try {
    const doc = editor.getDocumentSettings() || {};
    editor.updateDocumentSettings({ meta: { ...(doc.meta || {}), [KEY]: value } });
  } catch (e) { console.warn("lessonTimer write failed", e); }
}

export function timerRemainingMs(t, now = Date.now()) {
  if (!t) return 0;
  if (t.running) return Math.max(0, (t.endsAt || 0) - now);
  return Math.max(0, t.remainingMs || 0);
}


/* itflux r31: мягкий звук окончания (птичье пение, синтезировано, CC0), разблокировка аудио iOS */
const SOUND_URL = "/sounds/timer-birdsong.wav";
let audioCtx = null;
let audioBuf = null;
let audioLoading = null;
function getCtx() {
  if (audioCtx) return audioCtx;
  const C = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!C) return null;
  try { audioCtx = new C(); } catch { audioCtx = null; }
  return audioCtx;
}
function loadSound() {
  const ctx = getCtx();
  if (!ctx || audioBuf || audioLoading) return audioLoading;
  audioLoading = fetch(SOUND_URL).then((r) => r.arrayBuffer())
    .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
    .then((b) => { audioBuf = b; return b; }).catch(() => { audioLoading = null; return null; });
  return audioLoading;
}
function unlockAudio() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
  loadSound();
}
if (typeof window !== "undefined" && !window.__itfluxTimerAudioUnlock) {
  window.__itfluxTimerAudioUnlock = true;
  const onFirst = () => {
    try { unlockAudio(); } catch { /* ignore */ }
    if (audioCtx && audioCtx.state === "running") {
      ["pointerdown", "touchend", "keydown"].forEach((e) => window.removeEventListener(e, onFirst, true));
    }
  };
  ["pointerdown", "touchend", "keydown"].forEach((e) => window.addEventListener(e, onFirst, true));
}
async function playTimerSound() {
  const ctx = getCtx();
  try {
    if (ctx) {
      if (ctx.state === "suspended") await ctx.resume();
      const buf = audioBuf || (await loadSound());
      if (buf && ctx.state === "running") {
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = 0.35;
        src.buffer = buf;
        src.connect(gain).connect(ctx.destination);
        src.start(0);
        return;
      }
    }
    const a = new Audio(SOUND_URL);
    a.volume = 0.35;
    await a.play();
  } catch { /* autoplay blocked — молча */ }
}
const playedTimers = new Set();
function useTimerEndSound(t, done) {
  useEffect(() => {
    try {
    if (!done || !t) return;
    const key = String(t.id || t.endsAt);
    if (playedTimers.has(key)) return;
    playedTimers.add(key);
    try {
      const sk = `itflux-timer-sound-${key}`;
      if (window.sessionStorage.getItem(sk)) return;
      window.sessionStorage.setItem(sk, "1");
    } catch { /* ignore */ }
    // не играть для давно истёкшего таймера при открытии страницы
    if (t.running && t.endsAt && Date.now() - t.endsAt > 15000) return;
    playTimerSound().catch(() => {});
    } catch { /* ignore */ }
  }, [done, t]);
}

const MAX_MIN = 180;

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function useLessonTimer() {
  const editor = useEditor();
  const t = useValue("lesson-timer", () => readLessonTimer(editor), [editor]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!t?.running) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [t?.running, t?.endsAt]);
  return { editor, t, now };
}

function LessonTimerControlsInner() {
  const { editor, t, now } = useLessonTimer();
  const readonly = useValue("lesson-timer-ro", () => editor.getIsReadonly(), [editor]);
  const remaining = t ? timerRemainingMs(t, now) : 10 * 60 * 1000;
  const [mm, setMm] = useState("");
  const [ss, setSs] = useState("");
  const [err, setErr] = useState("");
  const startMs = (ms) => {
    unlockAudio();
    writeLessonTimer(editor, {
      running: true, endsAt: Date.now() + ms, durationMs: ms, remainingMs: ms, id: Date.now(),
    });
  };
  const set = (minutes) => startMs(minutes * 60000);
  const startCustom = (event) => {
    event?.preventDefault?.();
    const m = mm.trim() === "" ? 0 : Number(mm);
    const sec = ss.trim() === "" ? 0 : Number(ss);
    if (!Number.isInteger(m) || !Number.isInteger(sec) || m < 0 || sec < 0 || sec > 59) {
      setErr("Минуты — целое число, секунды — от 0 до 59");
      return;
    }
    const total = (m * 60 + sec) * 1000;
    if (total < 1000) { setErr("Минимум 1 секунда"); return; }
    if (total > MAX_MIN * 60000) { setErr(`Максимум ${MAX_MIN} минут`); return; }
    setErr("");
    startMs(total);
  };
  const digits = (v, max) => v.replace(/\D/g, "").slice(0, max);
  const toggle = () => {
    if (!t) return set(10);
    if (t.running) writeLessonTimer(editor, { ...t, running: false, remainingMs: timerRemainingMs(t) });
    else if ((t.remainingMs || 0) > 0) unlockAudio(), writeLessonTimer(editor, { ...t, running: true, endsAt: Date.now() + t.remainingMs });
  };
  return (
    <div className="lesson-board-menu__timer">
      <p className="lesson-timer">{fmt(remaining)}</p>
      {readonly ? <p className="lesson-flyout__note">Таймер запускает преподаватель</p> : (
        <>
          <div className="lesson-formula">
            {[1, 3, 5, 10, 15, 25].map((m) => (
              <button key={m} type="button" className="lesson-choice" onClick={() => set(m)}>{m}</button>
            ))}
          </div>
          <form className="lesson-timer-custom" onSubmit={startCustom} noValidate>
            <label className="lesson-timer-custom__field">
              <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" enterKeyHint="go"
                placeholder="мин" aria-label="Минуты" value={mm} onChange={(e) => { setMm(digits(e.target.value, 3)); setErr(""); }} />
              <span>мин</span>
            </label>
            <span className="lesson-timer-custom__sep">:</span>
            <label className="lesson-timer-custom__field">
              <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" enterKeyHint="go"
                placeholder="сек" aria-label="Секунды" value={ss} onChange={(e) => { setSs(digits(e.target.value, 2)); setErr(""); }} />
              <span>сек</span>
            </label>
            <button type="submit" className="lesson-choice lesson-timer-custom__start">Старт</button>
          </form>
          {err ? <p className="lesson-flyout__note lesson-timer-custom__err" role="alert">{err}</p> : null}
          <div className="lesson-formula">
            <button type="button" className="lesson-menu__item" onClick={toggle}>
              {t?.running ? "Пауза" : "Старт"}
            </button>
            {t ? (
              <button type="button" className="lesson-menu__item" onClick={() => writeLessonTimer(editor, null)}>Сброс</button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function LessonTimerWidgetInner() {
  const { editor, t, now } = useLessonTimer();
  const readonly = useValue("lesson-timer-ro", () => editor.getIsReadonly(), [editor]);
  const remaining = t ? timerRemainingMs(t, now) : 0;
  const done = !!t && remaining <= 0 && !!(t.running || (t.durationMs && !t.remainingMs));
  useTimerEndSound(t, done); // r32: hook must run before early return (hooks order)
  if (!t) return null;
  const total = t.durationMs || 1;
  const progress = Math.max(0, Math.min(1, remaining / total));
  const warn = !done && remaining <= 10000;
  return (
    <>
      <div
        className={`lesson-timer-widget${done ? " is-done" : ""}${warn ? " is-warn" : ""}${t.running ? "" : " is-paused"}`}
        role="timer"
        aria-live="polite"
        onPointerDown={(event) => editor.markEventAsHandled(event)}
        style={{ "--lesson-timer-progress": progress }}
      >
        <Timer size={16} strokeWidth={2} aria-hidden="true" />
        <span className="lesson-timer-widget__time">{done ? "00:00" : fmt(remaining)}</span>
        {!readonly ? (
          <button type="button" className="lesson-timer-widget__close" aria-label="Убрать таймер" onClick={() => writeLessonTimer(editor, null)}>×</button>
        ) : null}
        <span className="lesson-timer-widget__bar" aria-hidden="true" />
      </div>
      {done ? (
        <div className="lesson-timer-done" key={t.id || t.endsAt} aria-live="assertive">
          <div className="lesson-timer-done__card">
            <Timer size={40} strokeWidth={2} aria-hidden="true" />
            <span>Время вышло!</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* itflux r32: local error boundary — timer must never crash the board */
class TimerBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error("lessonTimer crashed", err); } catch { /* ignore */ } }
  render() { return this.state.err ? (this.props.fallback ?? null) : this.props.children; }
}
export function LessonTimerWidget() {
  return <TimerBoundary><LessonTimerWidgetInner /></TimerBoundary>;
}
export function LessonTimerControls() {
  return <TimerBoundary fallback={<p className="lesson-flyout__note">Таймер недоступен</p>}><LessonTimerControlsInner /></TimerBoundary>;
}
