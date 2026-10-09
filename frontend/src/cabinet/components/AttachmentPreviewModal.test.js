/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  attachmentPreviewKind,
  isAppFileUrl,
  isAttachmentPreviewable,
  withFileIntent,
} from "./AttachmentPreviewModal";

describe("homework file open urls", () => {
  it("marks homework and submission files as app files", () => {
    expect(isAppFileUrl("/api/homework/attachments/abc/file/")).toBe(true);
    expect(isAppFileUrl("/api/cabinet/student/assignments/4/attached-file/")).toBe(true);
    expect(isAppFileUrl("https://docs.google.com/document/d/1")).toBe(false);
  });

  it("asks the server to show a file instead of forcing a download", () => {
    expect(withFileIntent("/api/homework/attachments/abc/file/", "inline"))
      .toBe("/api/homework/attachments/abc/file/?inline=1");
    expect(withFileIntent("/api/cabinet/homework/submissions/3/attached-files/9/?t=1", "download"))
      .toBe("/api/cabinet/homework/submissions/3/attached-files/9/?t=1&download=1");
  });

  it("does not rewrite external links", () => {
    expect(withFileIntent("https://example.com/a.pdf", "inline")).toBe("https://example.com/a.pdf");
  });

  it("turns a phone-local absolute file url into a relative one", () => {
    expect(withFileIntent("http://127.0.0.1:8000/api/homework/attachments/abc/file/", "inline"))
      .toBe("/api/homework/attachments/abc/file/?inline=1");
  });

  it("previews images and pdf by name even when the api path has no extension", () => {
    expect(attachmentPreviewKind({
      filename: "scan.pdf",
      url: "/api/cabinet/student/assignments/1/attached-file/",
    })).toBe("pdf");
    expect(isAttachmentPreviewable({
      name: "photo.jpg",
      url: "/api/homework/attachments/abc/file/",
    })).toBe(true);
    expect(isAttachmentPreviewable({
      name: "work.docx",
      url: "/api/homework/attachments/abc/file/",
    })).toBe(false);
  });
});
