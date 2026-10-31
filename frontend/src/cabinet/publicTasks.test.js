import { describe, it, expect } from "vitest";
import { isPublicTasksPath } from "./publicTasks";

describe("isPublicTasksPath (r130)", () => {
  it("bank is public", () => {
    expect(isPublicTasksPath("/tasks")).toBe(true);
    expect(isPublicTasksPath("/tasks/")).toBe(true);
  });
  it("my bank and cabinet stay private", () => {
    expect(isPublicTasksPath("/tasks/my")).toBe(false);
    expect(isPublicTasksPath("/tasks/my/new")).toBe(false);
    expect(isPublicTasksPath("/cabinet")).toBe(false);
    expect(isPublicTasksPath("/cabinet/my-variants")).toBe(false);
  });
});
