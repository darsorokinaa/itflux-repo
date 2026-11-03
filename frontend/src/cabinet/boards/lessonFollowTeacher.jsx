/* r142: «Ученики ко мне» — учитель ведёт камеру всех учеников. Состояние живёт в meta документа,
 * поэтому доходит до опоздавших и переживает переподключения. */
import { createContext, useContext, useEffect, useRef } from "react";
import { Users } from "lucide-react";
import { useEditor, useValue } from "tldraw";

import { isTeacherRole } from "./boardFollow";

export const LESSON_FOLLOW_KEY = "lessonFollowTeacher";
export const LessonRoleContext = createContext({ role: "", selfId: "" });

export function useLessonRole() {
  return useContext(LessonRoleContext)?.role || "";
}

/** id участника так, как он виден в presence (user:<id>). */
export function useLessonSelfId(editor) {
  return useContext(LessonRoleContext)?.selfId || String(editor.user.getId());
}

export function readLessonFollow(meta) {
  const raw = meta?.[LESSON_FOLLOW_KEY];
  if (!raw || typeof raw !== "object" || !raw.on || !raw.userId) return null;
  return { userId: String(raw.userId), name: typeof raw.name === "string" ? raw.name : "" };
}

export function setLessonFollow(editor, value) {
  const doc = editor.getDocumentSettings() || {};
  const meta = { ...(doc.meta || {}) };
  meta[LESSON_FOLLOW_KEY] = value ? { on: true, userId: String(value.userId), name: value.name || "", at: Date.now() } : null;
  editor.updateDocumentSettings({ meta });
}

function useLessonFollowState(editor) {
  return useValue("lesson-follow-teacher", () => readLessonFollow(editor.getDocumentSettings()?.meta), [editor]);
}

/** Кнопка учителя в верхней панели. */
export function LessonFollowTeacherButton({ className = "lesson-topbar__icon" }) {
  const editor = useEditor();
  const role = useLessonRole();
  const state = useLessonFollowState(editor);
  if (!isTeacherRole(role)) return null;
  const myId = useLessonSelfId(editor);
  const active = Boolean(state && state.userId === myId);
  const label = active ? "Отпустить учеников" : "Ученики ко мне";
  return (
    <button
      type="button"
      className={`${className} lesson-follow-teacher${active ? " lesson-follow-teacher--on" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      data-testid="lesson-follow-teacher"
      onClick={() => {
        if (active) setLessonFollow(editor, null);
        else {
          editor.stopFollowingUser();
          setLessonFollow(editor, { userId: myId, name: editor.user.getName() });
        }
      }}
    >
      <Users size={14} strokeWidth={1.8} aria-hidden="true" />
      <span className="lesson-follow-teacher__text">{label}</span>
    </button>
  );
}

/** У ученика: следует за учителем, пока режим включён; камера заблокирована. */
export function LessonFollowTeacherEnforcer() {
  const editor = useEditor();
  const role = useLessonRole();
  const state = useLessonFollowState(editor);
  const myId = useLessonSelfId(editor);
  const forced = Boolean(state && state.userId !== myId && !isTeacherRole(role));
  const leaderId = forced ? state.userId : "";
  const leaderHere = useValue(
    "lesson-follow-leader-here",
    () => Boolean(leaderId) && editor.getCollaborators().some((p) => String(p.userId) === leaderId),
    [editor, leaderId],
  );
  const followingId = useValue("lesson-follow-current", () => editor.getInstanceState().followingUserId || "", [editor]);
  const savedLock = useRef(null);

  useEffect(() => {
    if (!forced) return undefined;
    const opts = editor.getCameraOptions();
    savedLock.current = Boolean(opts.isLocked);
    editor.setCameraOptions({ ...opts, isLocked: true });
    return () => {
      editor.setCameraOptions({ ...editor.getCameraOptions(), isLocked: savedLock.current || false });
      if (String(editor.getInstanceState().followingUserId || "") === leaderId) editor.stopFollowingUser();
    };
  }, [editor, forced, leaderId]);

  useEffect(() => {
    if (!forced || !leaderHere) return;
    if (String(followingId) === leaderId) return;
    editor.startFollowingUser(leaderId);
  }, [editor, forced, leaderHere, followingId, leaderId]);

  if (!forced) return null;
  return (
    <div className="lesson-follow-banner" role="status" data-testid="lesson-follow-banner">
      {leaderHere ? "Вы следите за учителем" : "Вы следите за учителем — ждём подключения учителя…"}
    </div>
  );
}
