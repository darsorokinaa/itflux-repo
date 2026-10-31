import { describe, expect, it } from "vitest";
import { CABINET_NAV_GROUPS, CABINET_MORE_GROUPS, getCabinetSectionTitle } from "./cabinetNav";

describe("r128 live-variants nav", () => {
  it("desktop: after «Домашние задания»", () => {
    const ids = CABINET_NAV_GROUPS.find((g) => g.id === "control").items.map((i) => i.id);
    expect(ids.indexOf("my-variants")).toBe(ids.indexOf("review") + 1);
  });
  it("mobile «Ещё» has it", () => {
    const all = CABINET_MORE_GROUPS.flatMap((g) => g.items);
    expect(all.find((i) => i.id === "my-variants")?.path).toBe("/cabinet/my-variants");
  });
  it("title", () => {
    expect(getCabinetSectionTitle("/cabinet/live-variants")).toBe("Мои варианты");
  });
});
