import { useEffect, useState } from "react";
import { ChevronLeft, FileText, Maximize2, Menu, PhoneOff, Redo2, Share2, Timer, Undo2 } from "lucide-react";
import { createShapeId } from "@tldraw/tlschema";
import { useEditor, useValue } from "tldraw";

import LessonContextBar from "./LessonContextBar";
import { LessonPaperControl } from "./LessonPaper.jsx";
import LessonSheetSwitcher from "./LessonSheetSwitcher";
import LessonRail from "./LessonToolbar";
import { stopFollowing } from "./lessonBoardActions";
import {
  LESSON_BOARD_CHROME_SOURCE,
  lessonBoardPageTitle,
  lessonRoomChromeMessage,
  lessonZoomLabel,
  LESSON_ZOOM_STEPS,
  lessonClockText,
  readLessonBoardTitleParam,
} from "./lessonShell";

const ZOOM_ANIMATION = { animation: { duration: 120 } };

export default function LessonChrome() {
  const [studentView, setStudentView] = useState(false);
  return (
    <div className={`lesson-chrome${studentView ? " lesson-chrome--student" : ""}`} data-testid="lesson-chrome">
      <StickerEnter />
      <LessonTop onStudentView={setStudentView} />
      {studentView ? <StudentBanner onExit={() => setStudentView(false)} /> : null}
      <LessonRail />
      <LessonContextBar />
      <div className="lesson-zoom-dock">
        <ZoomControls />
      </div>
    </div>
  );
}

function StickerEnter() {
  const editor = useEditor();
  useEffect(() => {
    const container = editor.getContainer();
    const onKey = (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      const editing = editor.getEditingShape();
      if (!editing || editing.type !== "note") return;
      event.preventDefault();
      event.stopPropagation();
      const id = createShapeId();
      editor.setEditingShape(null);
      editor.createShape({
        id,
        type: "note",
        x: editing.x,
        y: editing.y + 200,
        props: { color: editing.props.color },
      });
      editor.select(id);
      editor.setEditingShape(id);
    };
    container.addEventListener("keydown", onKey, true);
    return () => container.removeEventListener("keydown", onKey, true);
  }, [editor]);
  return null;
}

const EMPTY_ROOM_CHROME = {
  lessonTitle: "",
  reserveRight: 0,
  inRoom: false,
  live: false,
  whenLabel: "",
  startsAt: "",
  endsAt: "",
  materialsCount: 0,
  materialsOpen: false,
  fullscreen: false,
  canFinish: false,
  finishing: false,
};

function useEmbeddedLessonChrome() {
  const [chrome, setChrome] = useState(() => ({
    ...EMPTY_ROOM_CHROME,
    lessonTitle: readLessonBoardTitleParam(typeof window === "undefined" ? "" : window.location.search),
  }));
  useEffect(() => {
    if (window.parent === window) return undefined;
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const next = lessonRoomChromeMessage(event.data);
      if (!next) return;
      setChrome(next);
    };
    window.addEventListener("message", onMessage);
    try {
      window.parent.postMessage(
        { source: LESSON_BOARD_CHROME_SOURCE, type: "board-chrome-ready" },
        window.location.origin,
      );
    } catch {
      /* комната урока недоступна */
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return chrome;
}

function postRoomAction(action) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage(
      { source: LESSON_BOARD_CHROME_SOURCE, type: "board-chrome-action", action },
      window.location.origin,
    );
  } catch {
    /* комната урока недоступна */
  }
}

function LessonTop({ onStudentView }) {
  const editor = useEditor();
  const [menu, setMenu] = useState(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const room = useEmbeddedLessonChrome();
  const pageTitle = lessonBoardPageTitle(room.lessonTitle);
  const people = useValue("lesson-top-people", () => editor.getCollaborators(), [editor]);
  const followingId = useValue(
    "lesson-following",
    () => editor.getInstanceState().followingUserId || "",
    [editor],
  );
  const [showElapsed, setShowElapsed] = useState(false);
  const now = useLessonNow(Boolean(room.live && room.startsAt));
  const clock = room.live ? lessonClockText(room.startsAt, room.endsAt, now, showElapsed) : "";
  function toggle(id) {
    setMenu((current) => (current === id ? null : id));
  }
  useEffect(() => {
    if (menu !== "paper") return undefined;
    const close = (event) => {
      if (event.target.closest?.(".lesson-board-menu, [aria-label='Меню']")) return;
      setMenu((current) => (current === "paper" ? null : current));
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  async function shareBoard() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <header className="lesson-top" onPointerDown={(event) => editor.markEventAsHandled(event)}>
      <div className="lesson-topbar" role="toolbar" aria-label="Доска">
        <div className="lesson-topbar__side">
          <TopIcon label="Назад" onClick={() => (room.inRoom ? postRoomAction("collapse") : window.history.back())}>
            <ChevronLeft size={17} strokeWidth={1.8} aria-hidden="true" />
          </TopIcon>
          <span className="lesson-topbar__pop">
            <TopIcon label="Меню" pressed={menu === "paper"} onClick={() => toggle("paper")}>
              <Menu size={17} strokeWidth={1.8} aria-hidden="true" />
            </TopIcon>
            {menu === "paper" ? (
              <div className="lesson-top__popover lesson-board-menu" role="menu" aria-label="Меню доски">
                <button type="button" className="lesson-menu__item" onClick={shareBoard}>
                  <Share2 size={16} strokeWidth={1.8} aria-hidden="true" />
                  {copied ? "Скопировано" : "Поделиться"}
                </button>
                <button
                  type="button"
                  className="lesson-menu__item"
                  aria-pressed={timerOpen}
                  onClick={() => setTimerOpen((value) => !value)}
                >
                  <Timer size={16} strokeWidth={1.8} aria-hidden="true" />
                  Таймер
                </button>
                {timerOpen ? <LessonTimer /> : null}
                <div className="lesson-board-menu__divider" aria-hidden="true" />
                <LessonPaperControl inline />
              </div>
            ) : null}
          </span>
          <span className={`lesson-topbar__lesson${clock ? " lesson-topbar__lesson--block" : ""}`} title={pageTitle}>
            <span className="lesson-topbar__lesson-name">{pageTitle}</span>
            {clock ? (
              <button
                type="button"
                className="lesson-topbar__live"
                aria-pressed={showElapsed}
                title={showElapsed ? "Сколько осталось" : "Сколько идёт урок"}
                onClick={() => {
                  if (room.endsAt) setShowElapsed((value) => !value);
                }}
              >
                <span className="lesson-topbar__dot" aria-hidden="true" />
                <span>Урок идёт · {clock}</span>
              </button>
            ) : null}
          </span>
          <LessonSheetSwitcher />
        </div>

        <div className="lesson-topbar__side lesson-topbar__side--end">
          {room.inRoom ? (
            <span className="lesson-materials">
              <span className="lesson-materials__name">
                {room.materialsCount ? `Материалы · ${room.materialsCount}` : "Материалы"}
              </span>
              <TopIcon
                label={room.materialsCount ? `Материалы · ${room.materialsCount}` : "Материалы"}
                showTitle={false}
                pressed={room.materialsOpen}
                onClick={() => postRoomAction("materials")}
              >
                <FileText size={17} strokeWidth={1.8} aria-hidden="true" />
              </TopIcon>
            </span>
          ) : null}
          <PeopleButton
            people={people}
            followingId={followingId}
            extraOpen={menu === "students"}
            onExtra={() => toggle("students")}
            onFollow={(userId) => {
              if (followingId && String(followingId) === String(userId)) {
                stopFollowing(editor);
                onStudentView(false);
                return;
              }
              editor.startFollowingUser(userId);
              onStudentView(true);
            }}
            onStop={() => {
              stopFollowing(editor);
              onStudentView(false);
            }}
          />
          {room.canFinish ? (
            <TopIcon label="Завершить звонок" danger disabled={room.finishing} onClick={() => postRoomAction("finish")}>
              <PhoneOff size={17} strokeWidth={1.8} aria-hidden="true" />
            </TopIcon>
          ) : null}
          {menu === "students" ? <StudentsList people={people} onFollow={(userId) => {
            editor.startFollowingUser(userId);
            onStudentView(true);
            setMenu(null);
          }} /> : null}
        </div>
      </div>
    </header>
  );
}

function useLessonNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function TopIcon({ label, pressed, disabled, danger, showTitle = true, onClick, children }) {
  return (
    <button
      type="button"
      className={`lesson-topbar__icon${danger ? " lesson-topbar__icon--danger" : ""}`}
      aria-label={label}
      title={showTitle ? label : undefined}
      aria-pressed={pressed || undefined}
      disabled={disabled || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PeopleButton({ people, followingId, extraOpen, onExtra, onFollow, onStop }) {
  const editor = useEditor();
  const me = useValue("lesson-me", () => ({
    name: editor.user.getName() || "Я",
    color: editor.user.getColor() || "#2563eb",
  }), [editor]);
  const faces = people.slice(0, 3).map((person) => ({
    id: String(person.userId || person.id),
    name: person.userName || "Ученик",
    color: avatarColor(person.color, person.userName),
    avatar: person.meta?.avatarUrl || "",
  }));
  const extra = Math.max(0, people.length - 3);
  return (
    <span className="lesson-faces" role="group" aria-label={`Ученики ${people.length}`}>
      {faces.map((face) => (
        <button
          key={face.id}
          type="button"
          className="lesson-faces__dot"
          style={{ backgroundColor: face.color }}
          aria-label={`Следить за ${face.name}`}
          aria-pressed={Boolean(followingId) && String(followingId) === face.id}
          onClick={() => onFollow(face.id)}
        >
          {face.avatar ? <img className="lesson-faces__photo" src={face.avatar} alt="" /> : (String(face.name).trim().slice(0, 1).toUpperCase() || "•")}
        </button>
      ))}
      {extra ? (
        <button type="button" className="lesson-faces__more" aria-label="Остальные ученики" aria-pressed={extraOpen} onClick={onExtra}>
          +{extra}
        </button>
      ) : null}
      <button
        type="button"
        className="lesson-faces__dot"
        style={{ backgroundColor: avatarColor(me.color, me.name) }}
        aria-label="Моя доска"
        aria-pressed={!followingId}
        onClick={onStop}
      >
        {String(me.name).trim().slice(0, 1).toUpperCase() || "Я"}
      </button>
    </span>
  );
}

function avatarColor(color, name) {
  if (typeof color === "string" && color.startsWith("#")) return color;
  const palette = ["#4465e9", "#e03131", "#099268", "#ae3ec9", "#e16919", "#4ba1f1"];
  const text = String(name || "A");
  return palette[text.charCodeAt(0) % palette.length];
}

function StudentBanner({ onExit }) {
  const editor = useEditor();
  return (
    <button
      type="button"
      className="lesson-student-banner"
      onClick={() => {
        stopFollowing(editor);
        onExit();
      }}
    >
      Показ ученику. Вернуться к доске учителя
    </button>
  );
}

function StudentsList({ people, onFollow }) {
  return (
    <div className="lesson-top__popover" role="menu" aria-label="Ученики">
      {people.length ? people.map((person) => (
        <button key={person.userId || person.id} type="button" className="lesson-menu__item" onClick={() => onFollow(person.userId)}>
          {person.userName || "Ученик"}
        </button>
      )) : <p className="lesson-flyout__note">Пока на доске только вы</p>}
    </div>
  );
}

function LessonTimer() {
  const [seconds, setSeconds] = useState(10 * 60);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const label = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="lesson-board-menu__timer">
      <p className="lesson-timer">{label}</p>
      <div className="lesson-formula">
        {[5, 10, 15, 25].map((minutes) => (
          <button key={minutes} type="button" className="lesson-choice" onClick={() => { setSeconds(minutes * 60); setRunning(false); }}>
            {minutes}
          </button>
        ))}
      </div>
      <button type="button" className="lesson-menu__item" onClick={() => setRunning((value) => !value)}>
        {running ? "Пауза" : "Старт"}
      </button>
    </div>
  );
}

const ZOOM_PRESETS = LESSON_ZOOM_STEPS.filter((value) => value <= 2);

function ZoomControls() {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const zoom = useValue("lesson-zoom", () => editor.getZoomLevel(), [editor]);
  const undo = useValue("lesson-undo", () => editor.getCanUndo(), [editor]);
  const redo = useValue("lesson-redo", () => editor.getCanRedo(), [editor]);
  const center = () => editor.getViewportScreenCenter();
  useEffect(() => {
    editor.setCameraOptions({ zoomSteps: LESSON_ZOOM_STEPS });
  }, [editor]);
  function setZoom(value) {
    const camera = editor.getCamera();
    editor.setCamera({ x: camera.x, y: camera.y, z: value }, ZOOM_ANIMATION);
    setOpen(false);
  }
  return (
    <div className="lesson-zoom" role="group" aria-label="Масштаб" onPointerDown={(event) => editor.markEventAsHandled(event)}>
      <button type="button" className="lesson-icon" aria-label="Отменить" title="Отменить" disabled={!undo} onClick={() => editor.undo()}>
        <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="lesson-icon" aria-label="Повторить" title="Повторить" disabled={!redo} onClick={() => editor.redo()}>
        <Redo2 size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span className="lesson-dock__rule" aria-hidden="true" />
      <button type="button" className="lesson-icon" aria-label="Уменьшить" onClick={() => editor.zoomOut(center(), ZOOM_ANIMATION)}>−</button>
      <button type="button" className="lesson-zoom__value" aria-label={`Масштаб ${lessonZoomLabel(zoom)}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {lessonZoomLabel(zoom)}
      </button>
      <button type="button" className="lesson-icon" aria-label="Увеличить" onClick={() => editor.zoomIn(center(), ZOOM_ANIMATION)}>+</button>
      <button type="button" className="lesson-icon" aria-label="Вместить" onClick={() => editor.zoomToFit({ animation: { duration: 120 } })}>
        <Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <span className="lesson-zoom__menu" role="menu">
          {ZOOM_PRESETS.map((value) => (
            <button key={value} type="button" onClick={() => setZoom(value)}>{lessonZoomLabel(value)}</button>
          ))}
          <button type="button" onClick={() => { editor.zoomToFit({ animation: { duration: 120 } }); setOpen(false); }}>Вместить</button>
          <button type="button" onClick={() => { editor.zoomToSelection({ animation: { duration: 120 } }); setOpen(false); }}>К выделению</button>
        </span>
      ) : null}
    </div>
  );
}
