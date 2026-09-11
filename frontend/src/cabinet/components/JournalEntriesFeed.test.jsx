/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import JournalEntriesFeed from "./JournalEntriesFeed";

vi.mock("../../utils/cabinetAuth", () => ({
  fetchJournalEntries: vi.fn(),
}));

vi.mock("../CabinetIcons", () => ({
  default: function CabinetIcon({ name }) {
    return <span data-testid={`icon-${name}`} />;
  },
}));

import { fetchJournalEntries } from "../../utils/cabinetAuth";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("JournalEntriesFeed homework status", () => {
  it("shows submitted for late homework and a late icon", async () => {
    fetchJournalEntries.mockResolvedValue({
      entries: [
        {
          id: "homework-1-2",
          entry_type: "homework",
          title: "Дроби",
          student_name: "Анна",
          status: "submitted",
          status_label: "Сдано",
          submitted_at: "2026-09-10T12:00:00Z",
          is_overdue: true,
          submitted_late: true,
        },
      ],
      summary: {},
    });

    render(<JournalEntriesFeed studentId={2} />);

    expect(await screen.findByText("Дроби")).toBeTruthy();
    const badge = document.querySelector(".jg-status-badge");
    expect(badge?.textContent).toBe("Сдано");
    expect(screen.getByTitle("Сдано после срока")).toBeTruthy();
  });

  it("keeps overdue when homework was not turned in", async () => {
    fetchJournalEntries.mockResolvedValue({
      entries: [
        {
          id: "homework-3-2",
          entry_type: "homework",
          title: "Уравнения",
          student_name: "Анна",
          status: "overdue",
          status_label: "Просрочено",
          is_overdue: true,
          submitted_late: false,
        },
      ],
      summary: {},
    });

    render(<JournalEntriesFeed studentId={2} />);

    expect(await screen.findByText("Уравнения")).toBeTruthy();
    const badge = document.querySelector(".jg-status-badge");
    expect(badge?.textContent).toBe("Просрочено");
    expect(screen.queryByTitle("Сдано после срока")).toBeNull();
  });
});
