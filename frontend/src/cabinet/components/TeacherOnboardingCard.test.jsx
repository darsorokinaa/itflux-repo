/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TeacherOnboardingCard from "./TeacherOnboardingCard";

vi.mock("../../utils/cabinetAuth", () => ({
  dismissUiNotice: vi.fn().mockResolvedValue({}),
  createTeacherMaterial: vi.fn().mockResolvedValue({ id: 1 }),
}));

const checklist = {
  visible: true,
  next_step: "invite",
  total_steps: 3,
  cta: {
    label: "Добавить ученика",
    href: "/cabinet/students?invite=1",
    title: "Пригласите ученика",
    step: "invite",
  },
  steps: [
    { key: "invite", label: "Отправьте приглашение", done: false },
    { key: "accepted", label: "Ученик принял приглашение", done: false },
    { key: "homework", label: "Выдайте первое ДЗ", done: false },
  ],
};

describe("TeacherOnboardingCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows one sample lesson and one homework step for an empty cabinet", async () => {
    const { createTeacherMaterial } = await import("../../utils/cabinetAuth");
    render(
      <MemoryRouter>
        <TeacherOnboardingCard
          onboarding={{
            ...checklist,
            sample_lesson: {
              slug: "demo-lesson",
              title: "Электронные таблицы",
              subject: "Информатика",
              short_description: "Готовый демо-урок",
              preview_path: "/lessons?preview=demo-lesson",
            },
            sample_next_step: {
              label: "Выдайте первое домашнее задание",
              href: "/cabinet?assign=1",
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Открыть урок" }).getAttribute("href")).toBe(
      "/lessons?preview=demo-lesson",
    );
    expect(screen.getByRole("link", { name: "Выдайте первое домашнее задание" }).getAttribute("href")).toBe(
      "/cabinet?assign=1",
    );
    expect(screen.queryByText("Отправьте приглашение")).toBeNull();
    expect(screen.queryByText("Добавить ученика")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Взять в материалы" }));
    await waitFor(() => {
      expect(createTeacherMaterial).toHaveBeenCalledWith({
        title: "Электронные таблицы",
        material_type: "lesson",
        external_url: `${window.location.origin}/lessons?preview=demo-lesson`,
        topic: "Информатика",
        description: "Готовый демо-урок",
      });
    });
    expect(screen.getByRole("button", { name: "В материалах" })).toBeTruthy();
  });

  it("keeps the existing checklist when there is no sample", () => {
    render(
      <MemoryRouter>
        <TeacherOnboardingCard onboarding={checklist} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Отправьте приглашение")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Добавить ученика" })).toBeTruthy();
    expect(screen.queryByText("Выдайте первое домашнее задание")).toBeNull();
  });
});
