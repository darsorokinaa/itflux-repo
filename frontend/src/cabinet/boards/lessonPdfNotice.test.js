/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { disposePdfNotice, insertPdfFile } from "./lessonBoardActions";

function mountEditor() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return {
    root,
    editor: { getContainer: () => root },
  };
}

function badPdf(lastModified) {
  return new File(["not-a-pdf"], "notes.pdf", {
    type: "application/pdf",
    lastModified,
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("pdf status notice", () => {
  it("does not let an older timeout clear a newer insert", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { editor, root } = mountEditor();

    await insertPdfFile(editor, badPdf(1));
    expect(root.querySelector("[data-pdf-status]")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(1000);
    await insertPdfFile(editor, badPdf(2));
    expect(root.querySelector("[data-pdf-status]")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(4199);
    expect(root.querySelector("[data-pdf-status]")).toBeTruthy();
  });

  it("clears the pending timeout when the board unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { editor, root } = mountEditor();

    await insertPdfFile(editor, badPdf(3));
    expect(root.__itfluxPdfNotice.timer).not.toBe(0);

    disposePdfNotice(editor);
    await vi.advanceTimersByTimeAsync(5000);

    expect(root.__itfluxPdfNotice.timer).toBe(0);
    expect(root.__itfluxPdfNotice.disposed).toBe(true);
    expect(root.querySelector("[data-pdf-status]")).toBeTruthy();
  });

  it("does not paint a status after the board is disposed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { editor, root } = mountEditor();

    disposePdfNotice(editor);
    await insertPdfFile(editor, badPdf(4));
    await vi.advanceTimersByTimeAsync(5000);

    expect(root.__itfluxPdfNotice.timer).toBe(0);
    expect(root.querySelector("[data-pdf-status]")).toBeNull();
  });
});
