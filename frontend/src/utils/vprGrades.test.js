import { describe, expect, it } from "vitest";
import { gradesForVprSubject, unavailableVprGradeSearch } from "./vprGrades";

describe("VPR grades from the public bank", () => {
  it("hides informatics grade 10 when the API does not list it", () => {
    expect(gradesForVprSubject([7, 8])).toEqual([7, 8]);
    expect(gradesForVprSubject([7, 8]).includes(10)).toBe(false);
  });

  it("keeps math grade 10 when the subject has tasks there", () => {
    expect(gradesForVprSubject([7, 8, 10])).toEqual([7, 8, 10]);
    const params = new URLSearchParams("grade=10&advanced=0");
    expect(unavailableVprGradeSearch(params, [7, 8, 10])).toBeNull();
  });

  it("sends an old informatics grade 10 URL back to the subject without that grade", () => {
    const params = new URLSearchParams("grade=10&advanced=1");
    const next = unavailableVprGradeSearch(params, [7, 8]);
    expect(next).not.toBeNull();
    expect(next.get("grade")).toBeNull();
    expect(next.get("advanced")).toBe("1");
    expect(unavailableVprGradeSearch(new URLSearchParams("advanced=0"), [7, 8])).toBeNull();
  });

  it("shows a grade once the API includes it", () => {
    expect(gradesForVprSubject([7, 8]).includes(10)).toBe(false);
    expect(gradesForVprSubject([7, 8, 10]).includes(10)).toBe(true);
    expect(unavailableVprGradeSearch(new URLSearchParams("grade=10"), [7, 8, 10])).toBeNull();
  });
});
