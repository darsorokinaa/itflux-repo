import { describe, expect, it, vi } from "vitest";

import { acquireLiveCallKeepAlive } from "./liveMeetingGuard";

const UUID = "d81b69db-5558-4279-8fbd-7bfe018437e5";

describe("acquireLiveCallKeepAlive", () => {
  it("holds a Web Lock until released", async () => {
    let held = null;
    const nav = {
      locks: {
        request: vi.fn((name, cb) => {
          held = cb();
          return held;
        }),
      },
    };
    const release = acquireLiveCallKeepAlive(UUID, nav);
    expect(nav.locks.request).toHaveBeenCalledTimes(1);
    expect(nav.locks.request.mock.calls[0][0]).toContain(UUID);
    let done = false;
    held.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    release();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("is a no-op without the Web Locks API", () => {
    expect(() => acquireLiveCallKeepAlive(UUID, {})()).not.toThrow();
    expect(() => acquireLiveCallKeepAlive("", null)()).not.toThrow();
  });
});
