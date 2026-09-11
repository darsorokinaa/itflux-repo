import { describe, expect, it } from "vitest";
import {
  appendHomeworkAttachments,
  attachmentListKey,
  homeworkAttachmentKey,
  isHomeworkAttachmentImage,
  normalizeHomeworkAttachment,
  removeHomeworkAttachment,
  shouldHydrateAttachmentList,
  writeTaskAttachments,
  writeTeacherCommentAttachments,
} from "./homeworkAttachmentState";
import { homeworkTaskAttachments } from "../utils/cabinetHomework";
import { homeworkTeacherAttachments } from "./cabinetReviewUtils";

describe("homework attachment identity", () => {
  const a = { id: "a", url: "/media/a.jpg", filename: "a.jpg", content_type: "image/jpeg" };
  const b = { id: "b", url: "/media/b.png", filename: "b.png", content_type: "image/png" };
  const c = { id: "c", url: "/media/c.pdf", filename: "c.pdf", content_type: "application/pdf" };
  const d = { id: "d", url: "/media/d.docx", filename: "very-long-name.docx", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

  it("uses stable id as the React key, not index or url-only", () => {
    expect(homeworkAttachmentKey(a)).toBe("a");
    expect(homeworkAttachmentKey({ url: "/media/legacy.jpg" })).toBe("/media/legacy.jpg");
    expect(attachmentListKey([a, b, c])).toBe("a|b|c");
  });

  it("detects images by MIME first, then filename", () => {
    expect(isHomeworkAttachmentImage({ content_type: "image/jpeg", filename: "file.bin" })).toBe(true);
    expect(isHomeworkAttachmentImage({ filename: "scan.PNG" })).toBe(true);
    expect(isHomeworkAttachmentImage({ content_type: "application/pdf", filename: "c.pdf" })).toBe(false);
  });

  it("append keeps previous ids when adding another file", () => {
    const next = appendHomeworkAttachments([a, b], [c]);
    expect(next.map(homeworkAttachmentKey)).toEqual(["a", "b", "c"]);
  });

  it("delete first / middle / last keeps remaining ids", () => {
    const list = [a, b, c, d];
    expect(removeHomeworkAttachment(list, a).map(homeworkAttachmentKey)).toEqual(["b", "c", "d"]);
    expect(removeHomeworkAttachment(list, b).map(homeworkAttachmentKey)).toEqual(["a", "c", "d"]);
    expect(removeHomeworkAttachment(list, d).map(homeworkAttachmentKey)).toEqual(["a", "b", "c"]);
  });

  it("delete only attachment yields empty list that can be uploaded into again", () => {
    const empty = removeHomeworkAttachment([a], a);
    expect(empty).toEqual([]);
    expect(appendHomeworkAttachments(empty, [b]).map(homeworkAttachmentKey)).toEqual(["b"]);
  });

  it("does not hydrate from a stale parent snapshot of the same identity set", () => {
    const localAfterDelete = [a, c];
    const staleParent = [a, b, c];
    const lastHydratedKey = attachmentListKey(staleParent);
    const decision = shouldHydrateAttachmentList({
      incoming: staleParent,
      lastHydratedKey,
    });
    expect(decision.hydrate).toBe(false);
    expect(removeHomeworkAttachment(staleParent, b).map(homeworkAttachmentKey)).toEqual(
      localAfterDelete.map(homeworkAttachmentKey),
    );
  });

  it("hydrates when the server identity set actually changed", () => {
    const decision = shouldHydrateAttachmentList({
      incoming: [a, c],
      lastHydratedKey: attachmentListKey([a, b, c]),
    });
    expect(decision.hydrate).toBe(true);
    expect(decision.key).toBe("a|c");
  });

  it("two rapid appends via functional updates do not drop the first file", () => {
    let state = [];
    const uploadA = (prev) => appendHomeworkAttachments(prev, [a]);
    const uploadB = (prev) => appendHomeworkAttachments(prev, [b]);
    state = uploadA(state);
    state = uploadB(state);
    expect(state.map(homeworkAttachmentKey)).toEqual(["a", "b"]);
  });

  it("upload while delete finishes keeps the surviving file", () => {
    let state = [a, b];
    state = removeHomeworkAttachment(state, b);
    state = appendHomeworkAttachments(state, [c]);
    expect(state.map(homeworkAttachmentKey)).toEqual(["a", "c"]);
  });

  it("writeTaskAttachments updates the canonical payload maps used by both UIs", () => {
    const payload = writeTaskAttachments({}, {
      taskId: "42",
      taskNumber: "16",
      attachments: [a, c],
    });
    expect(homeworkTaskAttachments(payload, "42", "16").map(homeworkAttachmentKey)).toEqual(["a", "c"]);
    const teacherPayload = writeTaskAttachments({}, {
      taskId: "20",
      taskNumber: "20",
      attachments: [b],
      teacher: true,
    });
    expect(homeworkTeacherAttachments(teacherPayload, "20", "20").map(homeworkAttachmentKey)).toEqual(["b"]);
  });

  it("deleting comment attachments does not rewrite another task map", () => {
    let result = writeTaskAttachments({}, {
      taskId: "10",
      taskNumber: "10",
      attachments: [a, b],
      teacher: true,
    });
    result = writeTeacherCommentAttachments(result, [c, d]);
    result = writeTeacherCommentAttachments(result, [d]);
    expect(result.teacher_comment_attachments.map((item) => item.id)).toEqual(["d"]);
    expect(result.teacher_attachments_by_task_id["10"].map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("normalizes a backend upload response into the render object", () => {
    const item = normalizeHomeworkAttachment({
      id: "418",
      name: "photo.jpg",
      url: "/media/photo.jpg",
      content_type: "image/jpeg",
    });
    expect(item).toMatchObject({
      id: "418",
      filename: "photo.jpg",
      url: "/media/photo.jpg",
      isImage: true,
    });
  });
});
