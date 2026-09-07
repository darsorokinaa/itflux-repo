/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TaskFileAttachment, { collectTaskFiles } from "./TaskFileAttachment";

describe("collectTaskFiles", () => {
  it("collects TaskAttachment rows and legacy file fields", () => {
    expect(
      collectTaskFiles({
        attachments: [{ url: "/media/task_files/teacher_1/grafik.png", name: "grafik.png" }],
        file_url: "/media/task_files/legacy.zip",
        file: "/media/task_files/legacy.zip",
      })
    ).toEqual([
      { url: "/media/task_files/teacher_1/grafik.png", name: "grafik.png" },
      { url: "/media/task_files/legacy.zip", name: "" },
    ]);
  });

  it("accepts variant payload with file instead of file_url", () => {
    expect(
      collectTaskFiles({
        file: "/media/task_files/teacher_1/archive.zip",
      })
    ).toEqual([{ url: "/media/task_files/teacher_1/archive.zip", name: "" }]);
  });
});

describe("TaskFileAttachment", () => {
  it("renders attached images as pictures", () => {
    const { container } = render(
      <TaskFileAttachment href="/media/task_files/teacher_1/grafik.png" name="grafik.png" />
    );
    const img = container.querySelector("img.task-attachment-image");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("/media/task_files/teacher_1/grafik.png");
  });
});
