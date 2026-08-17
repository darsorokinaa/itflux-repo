const INVITE_TOKEN_KEY = "cabinet_invite_token";

export function rememberInviteToken(token) {
  const value = String(token || "").trim();
  if (!value) return;
  try {
    sessionStorage.setItem(INVITE_TOKEN_KEY, value);
  } catch {
    /* ignore */
  }
}

export function readStoredInviteToken() {
  try {
    return sessionStorage.getItem(INVITE_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function clearStoredInviteToken() {
  try {
    sessionStorage.removeItem(INVITE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function inviteJoinPath(token) {
  return `/invite/${encodeURIComponent(token)}/`;
}

export function inviteLoginPath(token, { mode = "login" } = {}) {
  const params = new URLSearchParams();
  params.set("invite", token);
  if (mode && mode !== "login") params.set("mode", mode);
  return `/cabinet/login?${params.toString()}`;
}

/**
 * Куда идти после login/register, если в запросе был invite_token.
 * false invite_accepted — не считать сценарий успешным.
 */
export function inviteAuthFollowUp({ inviteToken, result } = {}) {
  if (!inviteToken) return { kind: "default" };
  if (result && result.invite_accepted === false) {
    return {
      kind: "invite-retry",
      path: inviteJoinPath(inviteToken),
      error: result.invite_error || "Не удалось принять приглашение. Попробуйте ещё раз.",
      code: result.invite_error_code || "invite_accept_failed",
    };
  }
  if (result?.invite_accepted === true) {
    clearStoredInviteToken();
  }
  return { kind: "invite", path: inviteJoinPath(inviteToken) };
}
