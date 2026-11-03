import { describe, expect, it } from "vitest";
import { LESSON_FOLLOW_KEY, readLessonFollow, setLessonFollow } from "./lessonFollowTeacher";

describe("r142 ученики ко мне", () => {
  it("читает состояние из meta документа", () => {
    expect(readLessonFollow({})).toBeNull();
    expect(readLessonFollow({ [LESSON_FOLLOW_KEY]: null })).toBeNull();
    expect(readLessonFollow({ [LESSON_FOLLOW_KEY]: { on: false, userId: "user:1" } })).toBeNull();
    expect(readLessonFollow({ [LESSON_FOLLOW_KEY]: { on: true, userId: "user:1", name: "У" } })).toEqual({ userId: "user:1", name: "У" });
  });
  it("включает и выключает, не трогая остальную meta", () => {
    let doc = { meta: { paper: "grid" } };
    const editor = { getDocumentSettings: () => doc, updateDocumentSettings: (p) => { doc = { ...doc, ...p }; } };
    setLessonFollow(editor, { userId: "user:7", name: "T" });
    expect(readLessonFollow(doc.meta).userId).toBe("user:7");
    expect(doc.meta.paper).toBe("grid");
    setLessonFollow(editor, null);
    expect(readLessonFollow(doc.meta)).toBeNull();
  });
});
