import { describe, expect, it } from "vitest";
import {
  applyReorderWithTopic,
  destinationTopic,
  dropIndexFromY,
  groupSessionsByTopic,
  visualDropLineIndex,
  lessonsWord,
  mapIndexAfterMove,
  moveListItem,
  moveSessionToTopic,
  renameTopicInRange,
  shouldShowTopicChrome,
  uniquePlanTopics,
} from "./planEditorGrouping";

const session = (topic, title = "") => ({ topic, title });

describe("groupSessionsByTopic", () => {
  it("groups consecutive lessons with the same topic", () => {
    const groups = groupSessionsByTopic([
      session("A"),
      session("A"),
      session("B"),
      session("A"),
    ]);
    expect(groups.map((g) => [g.topicKey, g.indices])).toEqual([
      ["A", [0, 1]],
      ["B", [2]],
      ["A", [3]],
    ]);
  });

  it("keeps empty topics as their own consecutive group", () => {
    const groups = groupSessionsByTopic([session(""), session(""), session("A")]);
    expect(groups).toHaveLength(2);
    expect(groups[0].topicKey).toBe("");
    expect(groups[0].indices).toEqual([0, 1]);
  });
});

describe("shouldShowTopicChrome", () => {
  it("hides chrome when every topic is empty", () => {
    expect(shouldShowTopicChrome(groupSessionsByTopic([session(""), session("")]))).toBe(false);
  });

  it("shows chrome when at least one topic exists", () => {
    expect(shouldShowTopicChrome(groupSessionsByTopic([session("A"), session("")]))).toBe(true);
  });
});

describe("uniquePlanTopics", () => {
  it("returns unique non-empty topics in order of first appearance", () => {
    expect(uniquePlanTopics([session("A"), session("B"), session("A"), session("")])).toEqual(["A", "B"]);
  });
});

describe("moveListItem / dropIndexFromY", () => {
  it("moves an item down and up", () => {
    expect(moveListItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveListItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("does not copy the list when the index is unchanged", () => {
    const list = ["a", "b"];
    expect(moveListItem(list, 1, 1)).toBe(list);
  });

  it("computes insert index from card midpoints, ignoring the dragged item", () => {
    const rects = [
      { top: 0, height: 40 },
      { top: 50, height: 40 },
      { top: 100, height: 40 },
    ];
    expect(dropIndexFromY(10, rects, 0)).toBe(0);
    expect(dropIndexFromY(80, rects, 0)).toBe(1);
    expect(dropIndexFromY(200, rects, 0)).toBe(2);
    expect(dropIndexFromY(10, rects, 1)).toBe(0);
  });
});

describe("applyReorderWithTopic", () => {
  it("updates topic when a lesson lands inside another topic group", () => {
    const sessions = [session("A", "1"), session("A", "2"), session("B", "3")];
    const next = applyReorderWithTopic(sessions, 0, 2);
    expect(next.map((s) => s.topic)).toEqual(["A", "B", "B"]);
    expect(next[2].title).toBe("1");
  });

  it("keeps topic when reordering inside the same group", () => {
    const sessions = [session("A", "1"), session("A", "2"), session("A", "3")];
    expect(applyReorderWithTopic(sessions, 0, 2).map((s) => s.topic)).toEqual(["A", "A", "A"]);
  });

  it("does not send a no-op reorder", () => {
    const sessions = [session("A"), session("B")];
    expect(applyReorderWithTopic(sessions, 1, 1)).toBe(sessions);
  });
});

describe("moveSessionToTopic", () => {
  it("moves a lesson after the last item of the destination topic", () => {
    const sessions = [session("A", "1"), session("B", "2"), session("A", "3")];
    const next = moveSessionToTopic(sessions, 1, "A");
    expect(next.map((s) => s.title)).toEqual(["1", "3", "2"]);
    expect(next[2].topic).toBe("A");
  });
});

describe("renameTopicInRange / mapIndexAfterMove", () => {
  it("renames only the selected consecutive block", () => {
    const sessions = [session("A"), session("A"), session("B")];
    expect(renameTopicInRange(sessions, [0, 1], "C").map((s) => s.topic)).toEqual(["C", "C", "B"]);
  });

  it("tracks the expanded index across a move", () => {
    expect(mapIndexAfterMove(0, 0, 2)).toBe(2);
    expect(mapIndexAfterMove(2, 0, 2)).toBe(1);
    expect(mapIndexAfterMove(1, 2, 0)).toBe(2);
  });
});

describe("visualDropLineIndex", () => {
  it("places the line before the matching remaining item or after the list", () => {
    expect(visualDropLineIndex(0, 0, 3)).toBe(1);
    expect(visualDropLineIndex(0, 2, 3)).toBe(3);
    expect(visualDropLineIndex(2, 0, 3)).toBe(0);
  });
});

describe("lessonsWord", () => {
  it("uses Russian plural forms", () => {
    expect(lessonsWord(1)).toBe("урок");
    expect(lessonsWord(2)).toBe("урока");
    expect(lessonsWord(5)).toBe("уроков");
    expect(lessonsWord(21)).toBe("урок");
  });
});

describe("destinationTopic", () => {
  it("prefers the surrounding group topic", () => {
    const sessions = [session("A"), session("B"), session("B")];
    expect(destinationTopic(sessions, 0, 2)).toBe("B");
  });
});
