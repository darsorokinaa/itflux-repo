import { afterEach, describe, expect, it, vi } from "vitest";

const fetchTldrawSyncToken = vi.hoisted(() => vi.fn());

vi.mock("../../utils/cabinetAuth", () => ({
  fetchTldrawSyncToken: (...args) => fetchTldrawSyncToken(...args),
}));

import { prefetchTldrawSyncToken } from "./boardSyncPrefetch";

afterEach(() => {
  fetchTldrawSyncToken.mockReset();
});

describe("prefetchTldrawSyncToken", () => {
  it("reuses one request while the token is fresh", async () => {
    fetchTldrawSyncToken.mockResolvedValue({ token: "abc" });
    const boardId = `board-${Date.now()}`;
    const first = prefetchTldrawSyncToken(boardId);
    const second = prefetchTldrawSyncToken(boardId);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { token: "abc" },
      { token: "abc" },
    ]);
    expect(fetchTldrawSyncToken).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed request", async () => {
    const boardId = `board-fail-${Date.now()}`;
    fetchTldrawSyncToken.mockRejectedValueOnce(new Error("down"));
    await expect(prefetchTldrawSyncToken(boardId)).rejects.toThrow("down");
    fetchTldrawSyncToken.mockResolvedValueOnce({ token: "next" });
    await expect(prefetchTldrawSyncToken(boardId)).resolves.toEqual({ token: "next" });
    expect(fetchTldrawSyncToken).toHaveBeenCalledTimes(2);
  });
});
