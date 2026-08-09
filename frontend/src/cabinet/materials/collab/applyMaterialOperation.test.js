import { describe, expect, it } from "vitest";
import {
  applyMaterialOperation,
  canSendMaterialAction,
  getCapabilitiesForKind,
  htmlEventToMaterialOp,
  isFollowContentAction,
} from "./index";

describe("applyMaterialOperation", () => {
  it("stores answers in per-user buckets", () => {
    const next = applyMaterialOperation({}, {
      action: "answer_selected",
      payload: { questionId: "q1", value: "42" },
      authorId: 7,
      authorRole: "student",
    });
    expect(next.answers["7"].q1.value).toBe("42");
  });

  it("applies page and annotation without flattening answers", () => {
    let state = applyMaterialOperation({}, {
      action: "answer_selected",
      payload: { questionId: "q1", value: "a" },
      authorId: 3,
      authorRole: "student",
    });
    state = applyMaterialOperation(state, {
      action: "page_changed",
      payload: { page: 4 },
      authorId: 1,
      authorRole: "teacher",
    });
    state = applyMaterialOperation(state, {
      action: "annotation_added",
      payload: { annotation: { id: "a1", points: [[0.1, 0.2], [0.3, 0.4]], page: 4 } },
      authorId: 1,
      authorRole: "teacher",
    });
    expect(state.page).toBe(4);
    expect(state.annotations).toHaveLength(1);
    expect(state.answers["3"].q1.value).toBe("a");
  });

  it("clamps annotation points and keeps coordSpace", () => {
    const next = applyMaterialOperation({}, {
      action: "annotation_added",
      payload: {
        annotation: {
          id: "c1",
          points: [[-0.2, 1.5], [0.5, 0.5]],
          width: 0.004,
          coordSpace: "content_v1",
        },
      },
      authorId: 1,
      authorRole: "teacher",
    });
    expect(next.annotations[0].points[0]).toEqual([0, 1]);
    expect(next.annotations[0].coordSpace).toBe("content_v1");
    expect(next.annotations[0].width).toBeCloseTo(0.004);
  });

  it("applies cell_updated ops", () => {
    const next = applyMaterialOperation({}, {
      action: "cell_updated",
      payload: { sheetId: "sheet-1", cell: "b7", value: "125", revision: 48 },
      authorId: 2,
      authorRole: "student",
    });
    expect(next.sheets["sheet-1"].cells.B7.value).toBe("125");
    expect(next.activeCell).toBe("B7");
  });
});

describe("permissions", () => {
  it("allows follow content actions for students", () => {
    expect(isFollowContentAction("field_changed")).toBe(true);
    expect(canSendMaterialAction({
      action: "field_changed",
      canManage: false,
      interactionMode: "view_only",
      followingTeacher: true,
    })).toBe(true);
  });

  it("blocks draw for students in follow mode", () => {
    expect(canSendMaterialAction({
      action: "annotation_added",
      canManage: false,
      interactionMode: "view_only",
      followingTeacher: true,
    })).toBe(false);
  });

  it("allows annotate when collab permission is annotate", () => {
    expect(canSendMaterialAction({
      action: "annotation_added",
      canManage: false,
      interactionMode: "collaborative",
      collaborationPermission: "annotate",
    })).toBe(true);
  });
});

describe("capabilities + html bridge", () => {
  it("declares pdf capabilities", () => {
    const caps = getCapabilitiesForKind("pdf");
    expect(caps.pageNavigation).toBe(true);
    expect(caps.annotations).toBe(true);
  });

  it("maps html answer events", () => {
    const op = htmlEventToMaterialOp({
      type: "ANSWER_CHANGED",
      payload: { taskId: "task-5", value: "42" },
    });
    expect(op.action).toBe("field_changed");
    expect(op.payload.fieldId).toBe("task-5");
  });
});
