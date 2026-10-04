import { DefaultColorStyle, geoShapeProps } from "@tldraw/tlschema";

/** Same ids the sync server stores: `c` plus six hex digits. */
export const LESSON_CUSTOM_COLOR = /^c[0-9a-f]{6}$/;

const patched = new WeakSet();

/**
 * The server accepts any lesson custom color. useSync rebuilds the color enum
 * from the theme on every render, which drops ids that are not in this browser's
 * saved palette. A document that already uses such a color then fails validation
 * inside the connect handler, so the client never becomes synced.
 * Re-apply the acceptance after every enum rebuild.
 */
export function acceptLessonCustomColors(style) {
  if (patched.has(style)) return;
  patched.add(style);
  const addValues = style.addValues.bind(style);
  const removeValues = style.removeValues.bind(style);
  const wrap = () => {
    const builtin = style.type;
    style.type = {
      validate(value) {
        if (typeof value === "string" && LESSON_CUSTOM_COLOR.test(value)) return value;
        return builtin.validate(value);
      },
    };
  };
  style.addValues = (...values) => {
    addValues(...values);
    wrap();
  };
  style.removeValues = (...values) => {
    removeValues(...values);
    wrap();
  };
  wrap();
}

acceptLessonCustomColors(DefaultColorStyle);
acceptLessonCustomColors(geoShapeProps.labelColor);
