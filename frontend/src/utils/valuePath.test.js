/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  authLeadForIntent,
  authSearchWithNext,
  inferValueIntent,
  markFirstVisit,
  secondsSinceFirstVisit,
} from "./valuePath";

describe("inferValueIntent", () => {
  it("maps lesson, generator and cabinet return paths", () => {
    expect(inferValueIntent("/gotovye-uroki")).toBe("lesson");
    expect(inferValueIntent("/lessons?preview=graphs")).toBe("lesson");
    expect(inferValueIntent("/repetitor")).toBe("students");
    expect(inferValueIntent("/lessons/graphs/view")).toBe("lesson");
    expect(inferValueIntent("/subject/oge")).toBe("tasks");
    expect(inferValueIntent("/oge/inf")).toBe("tasks");
    expect(inferValueIntent("/cabinet")).toBe("students");
    expect(inferValueIntent("/cabinet/login?next=/lessons")).toBe("");
  });
});

describe("auth helpers", () => {
  it("keeps next in the register query", () => {
    expect(authSearchWithNext("/lessons?preview=graphs")).toBe(
      "?mode=register&next=%2Flessons%3Fpreview%3Dgraphs",
    );
  });

  it("ties registration copy to the lesson goal", () => {
    expect(authLeadForIntent("lesson", "register")).toContain("открыть этот урок");
  });
});

describe("time to first value timestamp", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("stores the first visit once", () => {
    markFirstVisit();
    const first = sessionStorage.getItem("itflux_first_visit_at");
    markFirstVisit();
    expect(sessionStorage.getItem("itflux_first_visit_at")).toBe(first);
    expect(secondsSinceFirstVisit()).toBeGreaterThanOrEqual(0);
  });
});
