import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getTlsyncProtocolVersion } from "@tldraw/sync-core";
import { WebSocket } from "ws";

import { createSyncServer } from "./server.mjs";
import { lessonSyncSchema } from "./schema.mjs";

const schema = lessonSyncSchema().serialize();

const SECRET = "verify-secret";
const BOARD_A = "11111111-1111-4111-8111-111111111111";
const BOARD_B = "22222222-2222-4222-8222-222222222222";

function token(boardId, { canEdit = true, exp = Math.floor(Date.now() / 1000) + 60 } = {}) {
  const payload = { board_id: boardId, can_edit: canEdit, exp, user_id: 7 };
  const ordered = {};
  for (const key of Object.keys(payload).sort()) ordered[key] = payload[key];
  const body = Buffer.from(JSON.stringify(ordered)).toString("base64url").replace(/=+$/, "");
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");
  return `${body}.${signature}`;
}

function connect(port, boardId, accessToken, sessionId) {
  const url = `ws://127.0.0.1:${port}/ws/tldraw/${boardId}/?access_token=${encodeURIComponent(accessToken)}&sessionId=${sessionId}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`timeout ${boardId} ${sessionId}`));
    }, 5000);
    socket.once("open", () => {
      socket.send(JSON.stringify({
        type: "connect",
        connectRequestId: sessionId,
        schema,
        protocolVersion: getTlsyncProtocolVersion(),
        lastServerClock: 0,
      }));
    });
    socket.once("message", (data) => {
      clearTimeout(timer);
      resolve({ socket, message: JSON.parse(data.toString()) });
    });
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolve({ socket, code });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tldraw-sync-"));
const first = await createSyncServer({ port: 0, secret: SECRET, dataDir });

const denied = await connect(first.port, BOARD_A, "not-a-token", "tab-denied");
assert(denied.code === 4401, `expected 4401, got ${denied.code}`);

const otherBoard = await connect(first.port, BOARD_A, token(BOARD_B), "tab-wrong-board");
assert(otherBoard.code === 4401, "token for another board must be rejected");

const alpha = await connect(first.port, BOARD_A, token(BOARD_A), "tab-a1");
const beta = await connect(first.port, BOARD_A, token(BOARD_A, { canEdit: false }), "tab-a2");
const gamma = await connect(first.port, BOARD_B, token(BOARD_B), "tab-b1");
assert(alpha.message?.type === "connect", "first client did not receive connect");
assert(beta.message?.type === "connect", "second client did not receive connect");
assert(gamma.message?.type === "connect", "other room did not receive connect");
assert(alpha.message.connectRequestId !== gamma.message.connectRequestId || alpha.message.serverClock !== undefined, "rooms answered");

const fileA = path.join(dataDir, `${BOARD_A}.sqlite`);
const fileB = path.join(dataDir, `${BOARD_B}.sqlite`);
assert(fs.existsSync(fileA) && fs.existsSync(fileB), "each board must have its own sqlite file");
assert(fs.statSync(fileA).ino !== fs.statSync(fileB).ino, "room files must be distinct");

alpha.socket.close();
beta.socket.close();
gamma.socket.close();
await new Promise((resolve) => setTimeout(resolve, 200));
first.close();
await new Promise((resolve) => setTimeout(resolve, 200));

const saved = new DatabaseSync(fileA);
const row = saved.prepare("SELECT schema, documentClock FROM metadata LIMIT 1").get();
saved.close();
assert(row && row.schema, "document must survive the process closing");

const second = await createSyncServer({ port: 0, secret: SECRET, dataDir });
const restored = await connect(second.port, BOARD_A, token(BOARD_A), "tab-restored");
assert(restored.message?.type === "connect", "reopened room did not sync");
restored.socket.close();
second.close();

console.log("tldraw sync verify ok");
