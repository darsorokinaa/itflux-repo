import { describe, expect, it } from "vitest";
import { createRemoteApplyGuard } from "./meetingMaterialCollab";

describe("createRemoteApplyGuard", () => {
  it("блокирует эхо во время remote apply", async () => {
    const guard = createRemoteApplyGuard();
    expect(guard.isRemote()).toBe(false);
    let seen = false;
    guard.run(() => {
      seen = guard.isRemote();
    });
    expect(seen).toBe(true);
    await Promise.resolve();
    expect(guard.isRemote()).toBe(false);
  });
});
