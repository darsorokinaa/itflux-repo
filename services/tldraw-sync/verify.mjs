import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getTlsyncProtocolVersion } from "@tldraw/sync-core";
import { DefaultColorStyle } from "@tldraw/tlschema";
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

const stale = new WebSocket(
  `ws://127.0.0.1:${first.port}/ws/tldraw/${BOARD_A}/?access_token=${encodeURIComponent(token(BOARD_A))}&sessionId=tab-race`,
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("stale open timeout")), 4000);
  stale.once("open", () => {
    clearTimeout(timer);
    resolve();
  });
  stale.once("error", reject);
});
const fresh = new WebSocket(
  `ws://127.0.0.1:${first.port}/ws/tldraw/${BOARD_A}/?access_token=${encodeURIComponent(token(BOARD_A))}&sessionId=tab-race`,
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("fresh open timeout")), 4000);
  fresh.once("open", () => {
    clearTimeout(timer);
    resolve();
  });
  fresh.once("error", reject);
});
let freshClosed = false;
fresh.on("close", () => {
  freshClosed = true;
});
stale.close();
await new Promise((resolve) => setTimeout(resolve, 300));
assert(fresh.readyState === WebSocket.OPEN && !freshClosed, "stale socket cancelled the replacement session");
const resumed = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("replacement session did not sync")), 2000);
  fresh.once("message", (data) => {
    clearTimeout(timer);
    resolve(JSON.parse(data.toString()));
  });
  fresh.send(JSON.stringify({
    type: "connect",
    connectRequestId: "tab-race",
    schema,
    protocolVersion: getTlsyncProtocolVersion(),
    lastServerClock: 0,
  }));
});
assert(resumed.type === "connect", "replacement session must stay in the room");
fresh.close();

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

assert(DefaultColorStyle.validate("c0e7f06") === "c0e7f06", "sync schema must accept a lesson custom color");

const IDLE_BOARD = "33333333-3333-4333-8333-333333333333";
const idleServer = await createSyncServer({ port: 0, secret: SECRET, dataDir });

function openClient(port, boardId, sessionId) {
  const url = `ws://127.0.0.1:${port}/ws/tldraw/${boardId}/?access_token=${encodeURIComponent(token(boardId))}&sessionId=${sessionId}`;
  const socket = new WebSocket(url);
  const messages = [];
  let closeCode = null;
  socket.on("message", (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      /* ignore non-json */
    }
  });
  socket.on("close", (code) => {
    closeCode = code;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`open timeout ${sessionId}`)), 5000);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("open", () => {
      socket.send(JSON.stringify({
        type: "connect",
        connectRequestId: sessionId,
        schema,
        protocolVersion: getTlsyncProtocolVersion(),
        lastServerClock: 0,
      }));
    });
    const wait = setInterval(() => {
      if (messages.some((message) => message.type === "connect")) {
        clearInterval(wait);
        clearTimeout(timer);
        resolve({ socket, messages, closeCode: () => closeCode });
      }
    }, 20);
  });
}

const drawer = await openClient(idleServer.port, IDLE_BOARD, "idle-a");
const watcher = await openClient(idleServer.port, IDLE_BOARD, "idle-b");
assert(drawer.messages.some((message) => message.type === "connect"), "first client did not reach board_synced");
assert(watcher.messages.some((message) => message.type === "connect"), "second client did not reach board_synced");

const textShape = {
  id: "shape:customcolor",
  typeName: "shape",
  type: "text",
  x: 16,
  y: 24,
  rotation: 0,
  index: "a2",
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  meta: {},
  props: {
    color: "c0e7f06",
    size: "s",
    w: 40,
    font: "draw",
    textAlign: "start",
    autoSize: true,
    scale: 1,
    richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
  },
};
drawer.socket.send(JSON.stringify({
  type: "push",
  clientClock: 1,
  diff: { [textShape.id]: ["put", textShape] },
}));
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("draw was not committed")), 5000);
  const wait = setInterval(() => {
    const committed = drawer.messages.some((message) =>
      message.type === "data"
      && message.data?.some((row) => row.type === "push_result" && row.action === "commit"),
    );
    const seen = watcher.messages.some((message) => JSON.stringify(message).includes("c0e7f06"));
    if (committed && seen) {
      clearInterval(wait);
      clearTimeout(timer);
      resolve();
    }
  }, 20);
});

const keepAlive = setInterval(() => {
  for (const client of [drawer, watcher]) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify({ type: "ping" }));
    }
  }
}, 5000);
await new Promise((resolve) => setTimeout(resolve, 32000));
clearInterval(keepAlive);
assert(drawer.closeCode() === null && drawer.socket.readyState === WebSocket.OPEN, "first client closed during 30s idle");
assert(watcher.closeCode() === null && watcher.socket.readyState === WebSocket.OPEN, "second client closed during 30s idle");

drawer.socket.close();
const again = await openClient(idleServer.port, IDLE_BOARD, "idle-a-reconnect");
const restoredConnect = again.messages.find((message) => message.type === "connect");
assert(restoredConnect && JSON.stringify(restoredConnect).includes("shape:customcolor"), "reconnect did not restore the drawing");
again.socket.close();
watcher.socket.close();
idleServer.close();

console.log("tldraw sync verify ok");
