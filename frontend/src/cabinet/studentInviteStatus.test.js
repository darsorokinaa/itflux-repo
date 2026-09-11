import { describe, expect, it, vi } from "vitest";

import {
  latestInviteForStudent,
  studentConnectionMeta,
  studentInviteMenuItems,
} from "./studentInviteStatus";

describe("studentInviteStatus", () => {
  it("picks the latest invite for the same student", () => {
    const student = { id: 154 };
    const invites = [
      { id: 1, pre_student: 154, created_at: "2026-01-01T00:00:00Z", status: "expired" },
      { id: 2, pre_student: 154, created_at: "2026-02-01T00:00:00Z", status: "pending" },
      { id: 3, pre_student: 99, created_at: "2026-03-01T00:00:00Z", status: "pending" },
    ];
    expect(latestInviteForStudent(student, invites).id).toBe(2);
  });

  it("does not match invites by name or email", () => {
    const student = { id: 154, name: "Анна", raw: { email: "anna@test.ru" } };
    const invites = [
      { id: 1, first_name: "Анна", email: "anna@test.ru", created_at: "2026-02-01T00:00:00Z" },
    ];
    expect(latestInviteForStudent(student, invites)).toBeNull();
  });

  it("shows connected / pending / expired states", () => {
    expect(studentConnectionMeta({ raw: { is_registered: true } }).text).toBe("Подключён");
    expect(studentConnectionMeta({ raw: { is_registered: false } }, { status: "pending" }).text)
      .toBe("Приглашение не принято");
    expect(studentConnectionMeta({ raw: { is_registered: false } }, { status: "expired" }).text)
      .toBe("Ссылка истекла");
  });

  it("offers resend for pending and new link for expired, not for connected students", () => {
    const copy = vi.fn();
    const renew = vi.fn();
    expect(studentInviteMenuItems({ raw: { is_registered: true } }, { status: "pending" })).toEqual([]);
    const pending = studentInviteMenuItems(
      { raw: { is_registered: false } },
      { id: 8, status: "pending" },
      { onCopy: copy, onResend: copy },
    );
    expect(pending.map((item) => item.label)).toEqual(["Скопировать ссылку", "Отправить повторно"]);
    const expired = studentInviteMenuItems(
      { id: 154, raw: { is_registered: false } },
      { id: 9, status: "expired" },
      { onRenew: renew },
    );
    expect(expired[0].label).toBe("Создать новую ссылку");
  });
});
