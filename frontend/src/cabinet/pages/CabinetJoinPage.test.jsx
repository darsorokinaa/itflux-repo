/** @vitest-environment jsdom */
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CabinetJoinPage from "./CabinetJoinPage";

vi.mock("../../utils/cabinetAuth", () => ({
  acceptInvitation: vi.fn(),
  fetchCabinetSession: vi.fn(async () => ({ authenticated: false })),
  fetchInvitationPreview: vi.fn(),
  getCabinetHomePath: vi.fn(() => "/cabinet/student"),
  logoutCabinetAndDetachPush: vi.fn(),
  openTelegramConnect: vi.fn(),
}));

vi.mock("../hooks/usePageTitle", () => ({
  usePageTitle: () => {},
}));

import { fetchInvitationPreview } from "../../utils/cabinetAuth";

function renderJoin(token = "tok-1") {
  return render(
    <MemoryRouter initialEntries={[`/invite/${token}/`]}>
      <Routes>
        <Route path="/invite/:token/" element={<CabinetJoinPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CabinetJoinPage", () => {
  it("explains that the teacher already added the student", async () => {
    fetchInvitationPreview.mockResolvedValue({
      status: "pending",
      teacher_name: "Анна Петрова",
      token: "tok-1",
    });
    renderJoin();
    expect(await screen.findByRole("heading", { name: "Подключиться к учителю" })).toBeTruthy();
    expect(screen.getByText(/Учитель уже добавил вас в класс/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Создать аккаунт" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "У вас уже есть аккаунт? Войти" })).toBeTruthy();
  });

  it("does not ask a connected student to register again", async () => {
    fetchInvitationPreview.mockResolvedValue({
      status: "already_registered",
      message: "Вы уже присоединились к этому учителю. Войдите в аккаунт, чтобы продолжить.",
      token: "tok-1",
    });
    renderJoin();
    expect(await screen.findByRole("heading", { name: "Вы уже присоединились к этому учителю" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Войти" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Создать аккаунт" })).toBeNull();
  });

  it("blocks silent reassignment when the student is linked to another account", async () => {
    fetchInvitationPreview.mockResolvedValue({
      status: "already_linked",
      message: "Этот профиль ученика уже связан с другим аккаунтом. Войдите в нужный аккаунт или обратитесь к учителю.",
      token: "tok-1",
    });
    renderJoin();
    expect(await screen.findByRole("heading", { name: "Профиль уже связан с другим аккаунтом" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Войти в нужный аккаунт" })).toBeTruthy();
  });

  it("shows expired copy without registration", async () => {
    const err = new Error("Срок действия ссылки истёк. Попросите учителя отправить новую ссылку.");
    err.status = 410;
    fetchInvitationPreview.mockRejectedValue(err);
    renderJoin();
    expect(await screen.findByRole("heading", { name: "Срок действия ссылки истёк" })).toBeTruthy();
    expect(screen.getByText(/Попросите учителя отправить новую ссылку/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Создать аккаунт" })).toBeNull();
  });
});
