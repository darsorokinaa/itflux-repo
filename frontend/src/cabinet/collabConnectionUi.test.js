import { describe, expect, it } from "vitest";
import {
  COLLAB_STATUS_GRACE_MS,
  COLLAB_UI,
  classifyCollabConnection,
  collabUiLabel,
  presenceCountLabel,
} from "./collabConnectionUi";

describe("classifyCollabConnection", () => {
  it("does not treat a single user as active collaboration", () => {
    const ui = classifyCollabConnection({ transport: "open", peerCount: 0, collaborative: true });
    expect(ui.kind).toBe(COLLAB_UI.CONNECTED);
    expect(ui.label).toBe("Подключено");
  });

  it("marks collaboration active only when a peer is connected", () => {
    const ui = classifyCollabConnection({ transport: "open", peerCount: 1, collaborative: true });
    expect(ui.kind).toBe(COLLAB_UI.COLLAB_ACTIVE);
    expect(ui.label).toBe("Совместное редактирование активно");
  });

  it("holds a brief reconnect without an error flash", () => {
    const ui = classifyCollabConnection({
      transport: "reconnecting",
      peerCount: 1,
      collaborative: true,
      reconnectElapsedMs: COLLAB_STATUS_GRACE_MS - 1,
    });
    expect(ui.kind).toBe(COLLAB_UI.CONNECTED);
    expect(ui.hold).toBe(true);
  });

  it("shows reconnecting after the grace period", () => {
    const ui = classifyCollabConnection({
      transport: "reconnecting",
      reconnectElapsedMs: COLLAB_STATUS_GRACE_MS,
    });
    expect(ui.kind).toBe(COLLAB_UI.RECONNECTING);
    expect(ui.label).toBe("Переподключение...");
  });

  it("offers retry without implying a page reload", () => {
    const ui = classifyCollabConnection({ transport: "failed" });
    expect(ui.showRetry).toBe(true);
    expect(collabUiLabel(ui.kind)).toContain("Попробовать снова");
  });
});

describe("presenceCountLabel", () => {
  it("uses Russian plural forms", () => {
    expect(presenceCountLabel(1)).toBe("1 участник");
    expect(presenceCountLabel(2)).toBe("2 участника");
    expect(presenceCountLabel(5)).toBe("5 участников");
  });
});
