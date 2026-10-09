import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushNotebookForPublish,
  flushOpenNotebooks,
  localNotebookFile,
  NOTEBOOK_VERSION_CONFLICT,
  publishAfterReady,
  registerNotebookFlush,
  resetNotebookPublishGateForTests,
  saveNotebookLatest,
  trackFeedbackUpload,
  UNSAVED_CLOSE_WARNING,
} from "./notebookPublishGate";

afterEach(() => {
  resetNotebookPublishGateForTests();
});

describe("publish waits for the latest notebook save", () => {
  it("commits the active stroke and confirms it before publish", async () => {
    const doc = { id: "nb", version: 1, pages: [] };
    const sent = [];
    registerNotebookFlush(() => flushNotebookForPublish({
      commitLive: () => {
        doc.pages = [{ id: "pen-live", type: "pen" }];
      },
      save: () => saveNotebookLatest({
        readLatest: () => doc,
        hasPending: () => false,
        clearPending: () => {},
        save: async (payload) => {
          sent.push(payload.pages.map((item) => item.id));
          return { version: payload.version + 1 };
        },
      }),
    }));
    const publish = vi.fn(async () => ({ status: "checked" }));

    await publishAfterReady({ publish });

    expect(sent).toEqual([["pen-live"]]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("waits for an autosave that is still in flight and then saves the newer stroke", async () => {
    let doc = { id: "nb", version: 1, pages: ["stroke-1"] };
    let pending = false;
    let releaseFirst;
    const bodies = [];
    registerNotebookFlush(() => saveNotebookLatest({
      readLatest: () => doc,
      hasPending: () => pending,
      clearPending: () => { pending = false; },
      save: async (payload) => {
        bodies.push([...payload.pages]);
        if (bodies.length === 1) {
          await new Promise((resolve) => { releaseFirst = resolve; });
          doc = { ...doc, version: payload.version + 1, pages: ["stroke-1", "stroke-2"] };
          pending = true;
          return { version: payload.version + 1 };
        }
        return { version: payload.version + 1 };
      },
    }));
    const publish = vi.fn(async () => ({ status: "checked" }));
    const job = publishAfterReady({ publish });

    await vi.waitFor(() => expect(bodies).toEqual([["stroke-1"]]));
    expect(publish).not.toHaveBeenCalled();
    releaseFirst();
    await job;

    expect(bodies[1]).toEqual(["stroke-1", "stroke-2"]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("confirms only the latest of several queued changes", async () => {
    let doc = { id: "nb", version: 1, pages: ["a"] };
    let pending = false;
    const bodies = [];
    const saved = await saveNotebookLatest({
      readLatest: () => doc,
      hasPending: () => pending,
      clearPending: () => { pending = false; },
      save: async (payload) => {
        bodies.push([...payload.pages]);
        if (bodies.length === 1) {
          doc = { ...doc, pages: ["a", "b", "c"] };
          pending = true;
          return { version: 2 };
        }
        return { version: 3 };
      },
    });

    expect(bodies).toEqual([["a"], ["a", "b", "c"]]);
    expect(saved.version).toBe(3);
  });

  it("does not publish when autosave fails or the server omits a version", async () => {
    registerNotebookFlush(() => saveNotebookLatest({
      readLatest: () => ({ id: "nb", version: 1, pages: ["a"] }),
      hasPending: () => false,
      clearPending: () => {},
      save: async () => {
        throw new Error("Не удалось сохранить тетрадь.");
      },
    }));
    const publish = vi.fn();

    await expect(publishAfterReady({ publish })).rejects.toThrow(/сохранить/);
    expect(publish).not.toHaveBeenCalled();

    resetNotebookPublishGateForTests();
    registerNotebookFlush(() => saveNotebookLatest({
      readLatest: () => ({ id: "nb", version: 1, pages: ["a"] }),
      hasPending: () => false,
      clearPending: () => {},
      save: async () => ({}),
    }));
    await expect(publishAfterReady({ publish })).rejects.toThrow(/не подтвердил/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer notebook from another tab", async () => {
    const bodies = [];
    let seenServer = null;
    const save = saveNotebookLatest({
      readLatest: () => ({ id: "nb", version: 1, pages: ["local"] }),
      hasPending: () => false,
      clearPending: () => {},
      onConflict: (err) => {
        seenServer = err.data.document;
      },
      save: async (payload) => {
        bodies.push({ version: payload.version, pages: [...payload.pages] });
        const err = new Error("conflict");
        err.code = "version_conflict";
        err.data = { current_version: 4, document: { id: "nb", version: 4, pages: ["server"] } };
        throw err;
      },
    });

    await expect(save).rejects.toThrow(NOTEBOOK_VERSION_CONFLICT);
    expect(bodies).toEqual([{ version: 1, pages: ["local"] }]);
    expect(seenServer.pages).toEqual(["server"]);
  });

  it("keeps local marks in a separate file and warns before closing unsaved", () => {
    const file = localNotebookFile({
      id: "nb",
      version: 2,
      pages: [{ id: "p", state: { objects: [{ type: "pen" }] } }],
    });
    expect(JSON.parse(file.body).pages[0].state.objects[0].type).toBe("pen");
    expect(file.filename.endsWith(".json")).toBe(true);
    expect(UNSAVED_CLOSE_WARNING).toMatch(/не попадут в проверку/);
    expect(UNSAVED_CLOSE_WARNING).toMatch(/без сохранения/);
  });
});

describe("publish waits for teacher files", () => {
  it("does not publish while a file is still uploading", async () => {
    let finishUpload;
    const upload = trackFeedbackUpload(new Promise((resolve) => { finishUpload = resolve; }));
    const order = [];
    registerNotebookFlush(async () => { order.push("flush"); });
    const publish = vi.fn(async () => { order.push("publish"); });
    const job = publishAfterReady({ publish });

    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    finishUpload({ id: 7 });
    await upload;
    await job;
    expect(order).toEqual(["flush", "publish"]);
  });

  it("does not publish when the upload fails", async () => {
    const upload = trackFeedbackUpload(Promise.reject(new Error("Не удалось загрузить файл")));
    const publish = vi.fn();

    await expect(publishAfterReady({ publish })).rejects.toThrow(/загрузить файл/);
    await expect(upload).rejects.toThrow(/загрузить файл/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("flushes every open notebook before publish", async () => {
    const order = [];
    registerNotebookFlush(async () => { order.push("first"); });
    registerNotebookFlush(async () => { order.push("second"); });
    await flushOpenNotebooks();
    expect(order.sort()).toEqual(["first", "second"]);
  });
});
