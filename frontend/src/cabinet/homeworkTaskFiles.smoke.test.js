import { describe, expect, it } from "vitest";
import { homeworkTaskAttachments } from "../utils/cabinetHomework";
import { homeworkTeacherAttachments } from "./cabinetReviewUtils";

describe("homework task files isolation smoke", () => {
  it("keeps cat.jpg on A and math.png on B after modeled reload", () => {
    const afterUpload = {
      task_attachments: {
        tasks: {
          A: {
            student: [{ id: "1", url: "/api/homework/attachments/1/file/", filename: "cat.jpg", content_type: "image/jpeg" }],
            teacher: [],
          },
          B: {
            student: [{ id: "2", url: "/api/homework/attachments/2/file/", filename: "math.png", content_type: "image/png" }],
            teacher: [],
          },
          C: {
            student: [{ id: "3", url: "/api/homework/attachments/3/file/", filename: "solution.pdf", content_type: "application/pdf" }],
            teacher: [],
          },
        },
        comment: [],
      },
    };
    const afterReload = JSON.parse(JSON.stringify(afterUpload));
    expect(homeworkTaskAttachments(afterReload, "A").map((f) => f.filename)).toEqual(["cat.jpg"]);
    expect(homeworkTaskAttachments(afterReload, "B").map((f) => f.filename)).toEqual(["math.png"]);
    expect(homeworkTaskAttachments(afterReload, "C").map((f) => f.filename)).toEqual(["solution.pdf"]);
    expect(homeworkTeacherAttachments(afterReload, "A").length).toBe(0);
  });
});
