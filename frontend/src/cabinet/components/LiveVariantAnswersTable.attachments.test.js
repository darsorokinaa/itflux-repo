import { describe, expect, it } from "vitest";
import { liveTaskAttachments } from "./LiveVariantAnswersTable";

const result = {
  task_attachments: {
    tasks: { 1226: { student: [{ id: "a1", name: "page-1.jpg", url: "/api/homework/attachments/a1/file/", mime_type: "image/jpeg" }], teacher: [] } },
    comment: [],
  },
};

describe("r127 live attachments", () => {
  it("returns student files of the task", () => {
    const files = liveTaskAttachments(result, { id: 1226, number: 3 });
    expect(files).toHaveLength(1);
    expect(files[0].url).toContain("/attachments/a1/");
  });
  it("empty for other task / no result", () => {
    expect(liveTaskAttachments(result, { id: 5, number: 1 })).toEqual([]);
    expect(liveTaskAttachments(null, { id: 1226 })).toEqual([]);
  });
});
