import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySyncToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !secret) return null;
  const [body, signature] = parts;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    if (!payload.board_id || Number(payload.exp) < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * r124: заявленные в токене поля БЕЗ проверки подписи — только для лога
 * попытки подключения (до валидации). Сам токен никогда не логируется.
 */
export function peekSyncTokenClaims(token) {
  const raw = String(token || "");
  if (!raw) return { state: "missing" };
  const parts = raw.split(".");
  if (parts.length !== 2) return { state: "malformed" };
  try {
    const body = parts[0];
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return { state: "malformed" };
    const exp = Number(payload.exp);
    return {
      state: Number.isFinite(exp) && exp < Date.now() / 1000 ? "expired" : "present",
      user_id: String(payload.user_id ?? "").slice(0, 32),
      board_id: String(payload.board_id ?? "").slice(0, 64),
    };
  } catch {
    return { state: "malformed" };
  }
}

/** IP клиента за nginx/relay: X-Real-IP, затем первый X-Forwarded-For, затем сокет. */
export function clientIpFromRequest(request) {
  const headers = request?.headers || {};
  const real = String(headers["x-real-ip"] || "").trim();
  if (real) return real.slice(0, 64);
  const forwarded = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded.slice(0, 64);
  return String(request?.socket?.remoteAddress || "").slice(0, 64);
}
