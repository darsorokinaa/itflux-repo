import { describe, expect, it, beforeEach } from "vitest";

import {
  clearStoredInviteToken,
  inviteAuthFollowUp,
  inviteJoinPath,
  inviteLoginPath,
  readStoredInviteToken,
  rememberInviteToken,
} from "./inviteAuth";

describe("inviteAuth", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("builds login path that keeps the invite token", () => {
    expect(inviteLoginPath("abc")).toBe("/cabinet/login?invite=abc");
    expect(inviteLoginPath("abc", { mode: "register" })).toBe(
      "/cabinet/login?invite=abc&mode=register",
    );
    expect(inviteJoinPath("abc")).toBe("/invite/abc/");
  });

  it("stores invite token for the switch-account roundtrip", () => {
    rememberInviteToken("tok-1");
    expect(readStoredInviteToken()).toBe("tok-1");
    clearStoredInviteToken();
    expect(readStoredInviteToken()).toBe("");
  });

  it("does not treat failed acceptance as success", () => {
    const follow = inviteAuthFollowUp({
      inviteToken: "tok-1",
      result: {
        ok: true,
        invite_accepted: false,
        invite_error: "Приглашение истекло",
        invite_error_code: "expired",
      },
    });
    expect(follow.kind).toBe("invite-retry");
    expect(follow.path).toBe("/invite/tok-1/");
    expect(follow.code).toBe("expired");
    expect(follow.error).toContain("истекло");
  });

  it("keeps the invite token after failed login acceptance so the user can retry", () => {
    rememberInviteToken("tok-2");
    const follow = inviteAuthFollowUp({
      inviteToken: "tok-2",
      result: {
        ok: true,
        invite_accepted: false,
        invite_error_code: "wrong_account",
        invite_error: "Эта ссылка предназначена для другого аккаунта.",
      },
    });
    expect(follow.kind).toBe("invite-retry");
    expect(follow.path).toBe("/invite/tok-2/");
    expect(readStoredInviteToken()).toBe("tok-2");
  });

  it("goes to the invite page after successful accept", () => {
    rememberInviteToken("tok-1");
    const follow = inviteAuthFollowUp({
      inviteToken: "tok-1",
      result: { ok: true, invite_accepted: true },
    });
    expect(follow.kind).toBe("invite");
    expect(readStoredInviteToken()).toBe("");
  });
});
