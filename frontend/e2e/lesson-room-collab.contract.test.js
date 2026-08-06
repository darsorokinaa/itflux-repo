/**
 * Minimal E2E checklist script documentation for lesson room collab.
 * Full Playwright suite should run with two browser contexts (teacher + student).
 *
 * Covered scenarios (manual / future Playwright):
 * 1. Teacher opens PDF — student sees same page
 * 2. Teacher scrolls — student follows
 * 3. Student browses away — return button appears
 * 4. Teacher changes page — student auto-returns
 * 5. Annotations sync
 * 6–8. HTML/interactive answers live + reconnect
 * 9–11. Spreadsheet cell ops + permissions + conflict revision
 * 12. Room isolation
 * 13–14. Mobile follow + reload restore
 */
import { describe, expect, it } from "vitest";
import { canSendMaterialAction, FOLLOW_STATUS } from "../src/cabinet/materials/collab";

describe("lesson room e2e contract stubs", () => {
  it("documents follow break as local-only navigation", () => {
    expect(canSendMaterialAction({
      action: "page_changed",
      canManage: false,
      interactionMode: "view_only",
      followingTeacher: false,
      localBrowsingAway: true,
    })).toBe(false);
    expect(FOLLOW_STATUS.BROWSING_AWAY).toBe("browsing_away");
  });
});
