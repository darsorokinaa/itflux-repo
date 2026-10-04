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
