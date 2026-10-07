import { geoShapeMigrations } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";

import { boardFileKind, insertBoardFile, insertLinkCard, placeImage } from "./lessonBoardActions";
import {
  LESSON_GEO_URL_MIGRATION_ID,
  clearInvalidGeoUrl,
  isLessonLinkUrl,
  withLessonGeoMigrations,
} from "./lessonGeoUrl";

const FILE_NAME = "Практическая работа № 3.docx";

function editorStub() {
  const updates = [];
  return {
    updates,
    getViewportPageBounds: () => ({ x: 0, y: 0, width: 800, height: 600, midX: 400, midY: 300 }),
    createShape: () => {},
    updateShape: (partial) => updates.push(partial),
    select: () => {},
  };
}

describe("lesson geo urls", () => {
  it("treats a filename as text, not a link", () => {
    expect(isLessonLinkUrl(FILE_NAME)).toBe(false);
    expect(isLessonLinkUrl("https://example.com/work.docx")).toBe(true);
    const props = { url: FILE_NAME };
    clearInvalidGeoUrl(props);
    expect(props.url).toBe("");
    const link = { url: "https://example.com/work.docx" };
    clearInvalidGeoUrl(link);
    expect(link.url).toBe("https://example.com/work.docx");
    const empty = { url: "" };
    clearInvalidGeoUrl(empty);
    expect(empty.url).toBe("");
  });

  it("adds a geo migration after the current tldraw sequence", () => {
    expect(geoShapeMigrations.sequence.at(-1).id).toBe("com.tldraw.shape.geo/12");
    const migrations = withLessonGeoMigrations(geoShapeMigrations);
    expect(migrations.sequence.at(-1).id).toBe(LESSON_GEO_URL_MIGRATION_ID);
    expect(migrations.sequence).toHaveLength(geoShapeMigrations.sequence.length + 1);
    const props = { url: FILE_NAME };
    migrations.sequence.at(-1).up(props);
    expect(props.url).toBe("");
  });

  it("does not store a filename on the shape link", () => {
    const fileCard = editorStub();
    insertLinkCard(fileCard, FILE_NAME, FILE_NAME);
    expect(fileCard.updates).toEqual([]);

    const linkCard = editorStub();
    insertLinkCard(linkCard, "https://example.com/work.docx", "Практическая работа");
    expect(linkCard.updates).toEqual([
      expect.objectContaining({ type: "geo", props: { url: "https://example.com/work.docx" } }),
    ]);
  });

  it("recognizes a photo with an empty mime type", () => {
    expect(boardFileKind({ name: "IMG_2048.HEIC", type: "" })).toBe("image");
    expect(boardFileKind({ name: "lecture.pdf", type: "" })).toBe("pdf");
    expect(boardFileKind({ name: FILE_NAME, type: "" })).toBe("file");
  });

  it("stores an added file so it can be downloaded", async () => {
    const fileCard = editorStub();
    fileCard.store = {
      props: {
        assets: {
          upload: async () => ({
            src: "/api/cabinet/interactive-boards/board/assets/11111111-1111-1111-1111-111111111111/",
          }),
        },
      },
    };
    await expect(insertBoardFile(fileCard, { name: FILE_NAME, type: "application/octet-stream" })).resolves.toBe("");
    expect(fileCard.updates).toEqual([
      expect.objectContaining({
        type: "geo",
        meta: {
          lessonKind: "file",
          fileName: FILE_NAME,
          fileUrl: "/api/cabinet/interactive-boards/board/assets/11111111-1111-1111-1111-111111111111/",
          fileMime: "application/octet-stream",
        },
      }),
    ]);
  });

  it("keeps an image on the board when storage refuses the upload", async () => {
    const editor = editorStub();
    editor.assets = [];
    editor.shapes = [];
    editor.createAssets = (rows) => editor.assets.push(...rows);
    editor.createShape = (shape) => editor.shapes.push(shape);
    editor.store = {
      props: {
        assets: {
          upload: async () => {
            throw new Error("Недостаточно места в хранилище");
          },
        },
      },
    };
    const png = new File([Uint8Array.from([137, 80, 78, 71])], "dot.png", { type: "image/png" });
    await placeImage(editor, png, 12, 8, "dot.png");
    expect(editor.shapes).toHaveLength(1);
    expect(editor.shapes[0].type).toBe("image");
    expect(editor.assets[0].props.src.startsWith("data:image/png")).toBe(true);
  });
});
