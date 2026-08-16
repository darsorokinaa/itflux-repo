/** @vitest-environment jsdom */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TariffUsageBlock, { formatUsed, exhaustedCaption } from "./TariffUsageBlock";

describe("TariffUsageBlock", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats limited and unlimited values from backend", () => {
    expect(formatUsed({ used: 7, limit: 20 })).toBe("7 / 20");
    expect(formatUsed({ used: 12, unlimited: true })).toBe("12 / ∞");
    expect(formatUsed({ used: 12.4, limit: 512, unit: "MB" })).toBe("12.4 / 512 МБ");
  });

  it("uses period-aware exhausted caption", () => {
    expect(exhaustedCaption({ period: "month" })).toBe("Лимит на текущий период исчерпан");
    expect(exhaustedCaption({ period: "current" })).toBe("Лимит исчерпан");
  });

  it("renders progress for limited metrics and skips bar for unlimited", () => {
    render(
      <TariffUsageBlock
        items={[
          {
            key: "variant_generations",
            label: "Генерация вариантов",
            used: 7,
            limit: 20,
            period: "month",
            unlimited: false,
            percent: 35,
            exhausted: false,
            near_limit: false,
          },
          {
            key: "groups",
            label: "Группы",
            used: 1,
            limit: null,
            period: "current",
            unlimited: true,
            percent: null,
            exhausted: false,
            near_limit: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("Использование тарифа")).toBeTruthy();
    expect(screen.getByText("Генерация вариантов")).toBeTruthy();
    expect(screen.getByText("7 / 20")).toBeTruthy();
    expect(screen.getByText("35%")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText("1 / ∞")).toBeTruthy();
    expect(screen.getByText("без лимита")).toBeTruthy();
  });

  it("shows exhausted caption and tariffs button without auto popup", () => {
    const onViewPlans = vi.fn();
    render(
      <TariffUsageBlock
        items={[
          {
            key: "students",
            label: "Ученики",
            used: 10,
            limit: 10,
            period: "current",
            unlimited: false,
            percent: 100,
            exhausted: true,
            near_limit: false,
          },
        ]}
        onViewPlans={onViewPlans}
      />,
    );
    expect(screen.getByText("Лимит исчерпан")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Посмотреть тарифы" }));
    expect(onViewPlans).toHaveBeenCalledTimes(1);
  });
});
