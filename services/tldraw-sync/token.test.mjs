// r124: node --test services/tldraw-sync/token.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { clientIpFromRequest, peekSyncTokenClaims, verifySyncToken } from "./token.mjs";

function make(payload, secret = "s") {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("peek reads claims without verifying and never returns the token", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = make({ board_id: "b1", user_id: 430, exp }, "other");
  const claims = peekSyncTokenClaims(token);
  assert.deepEqual(claims, { state: "present", user_id: "430", board_id: "b1" });
  assert.equal(verifySyncToken(token, "s"), null);
  assert.ok(!JSON.stringify(claims).includes(token.split(".")[1]));
});

test("peek states", () => {
  assert.equal(peekSyncTokenClaims("").state, "missing");
  assert.equal(peekSyncTokenClaims("abc").state, "malformed");
  assert.equal(peekSyncTokenClaims(make({ board_id: "b", user_id: 1, exp: 1 })).state, "expired");
});

test("client ip prefers x-real-ip", () => {
  assert.equal(clientIpFromRequest({ headers: { "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" } }), "1.2.3.4");
  assert.equal(clientIpFromRequest({ headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" } }), "5.6.7.8");
  assert.equal(clientIpFromRequest({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
});
