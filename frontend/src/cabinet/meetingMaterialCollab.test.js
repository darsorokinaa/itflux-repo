import { describe, expect, it } from "vitest";
import { createRemoteApplyGuard } from "./meetingMaterialCollab";
import { applyMaterialOperation } from "./materials/collab";

describe("createRemoteApplyGuard", () => {
  it("блокирует эхо во время remote apply", async () => {
    const guard = createRemoteApplyGuard();
    expect(guard.isRemote()).toBe(false);
    let seen = false;
    guard.run(() => {
      seen = guard.isRemote();
    });
    expect(seen).toBe(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(guard.isRemote()).toBe(false);
  });
});

describe("echo-safe local apply", () => {
  it("keeps per-user answers when remote page op arrives", () => {
    let state = applyMaterialOperation({}, {
      action: "field_changed",
      payload: { fieldId: "f1", value: "hello" },
      authorId: 9,
      authorRole: "student",
    });
    state = applyMaterialOperation(state, {
      action: "page_changed",
      payload: { page: 2 },
      authorId: 1,
      authorRole: "teacher",
    });
    expect(state.fields["9"].f1.value).toBe("hello");
    expect(state.page).toBe(2);
  });
});
