import { CollaboratorScribbleOverlayUtil } from "tldraw";

/* itflux r29: указка всегда ярко-красная и крупная, у всех участников */
export const LESSON_LASER_COLOR = "#ff1a1a";
export const LESSON_LASER_SIZE = 12;

let patched = false;
function patchCollaboratorLaser() {
  if (patched) return;
  const proto = CollaboratorScribbleOverlayUtil?.prototype;
  if (!proto?.getOverlays) return;
  patched = true;
  const original = proto.getOverlays;
  proto.getOverlays = function getOverlays(...args) {
    const overlays = original.apply(this, args) || [];
    return overlays.map((overlay) => {
      const scribble = overlay?.props?.scribble;
      if (scribble?.color !== "laser") return overlay;
      return {
        ...overlay,
        props: { ...overlay.props, color: LESSON_LASER_COLOR, scribble: { ...scribble, size: Math.max(scribble.size || 0, LESSON_LASER_SIZE) } },
      };
    });
  };
}

export function installLessonLaser(editor) {
  patchCollaboratorLaser();
  const scribbles = editor?.scribbles;
  if (!scribbles || typeof scribbles.addScribbleToSession !== "function") return () => {};
  const original = scribbles.addScribbleToSession;
  scribbles.addScribbleToSession = function addScribbleToSession(sessionId, scribble, ...rest) {
    const next = scribble?.color === "laser"
      ? { ...scribble, size: LESSON_LASER_SIZE, opacity: 1 }
      : scribble;
    return original.call(this, sessionId, next, ...rest);
  };
  return () => {
    scribbles.addScribbleToSession = original;
  };
}
