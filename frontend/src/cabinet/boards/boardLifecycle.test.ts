import { describe, expect, it } from "vitest";
import { phaseLabel } from "./boardLifecycle";

describe("boardLifecycle", () => {
  it("labels reconnect and failed phases for the recovery UI", () => {
    expect(phaseLabel("reconnecting")).toBe("Восстанавливаем соединение…");
    expect(phaseLabel("failed")).toBe("Не удалось восстановить соединение.");
  });
});
