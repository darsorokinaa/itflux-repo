/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InviteFormModal } from "./StudentGroupModals";

vi.mock("./CabinetModal", () => ({
  default: function CabinetModal({ title, children }) {
    return (
      <div>
        <h1>{title}</h1>
        {children}
      </div>
    );
  },
}));

vi.mock("../activationAnalytics", () => ({
  trackActivationIntent: vi.fn(),
}));

vi.mock("../../utils/cabinetAuth", () => ({
  buildInvitationUrl: (path) => `https://example.test${path}`,
  notifyBillingChanged: vi.fn(),
  resetStudentAccess: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe("InviteFormModal", () => {
  it("uses invite language instead of student registration", () => {
    render(<InviteFormModal onClose={() => {}} onCreate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Пригласить ученика" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Пригласить ученика" })).toBeTruthy();
    expect(screen.getByText(/учебный профиль появится в списке сразу/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Создать профиль и ссылку" })).toBeNull();
  });
});
