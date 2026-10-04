/**
 * Live tldraw-sync sleep/wake against the already running server.
 * Mints its own short token. Does not print the secret or the token.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { atom } from "@tldraw/state";
import { Store } from "@tldraw/store";
import { ClientWebSocketAdapter, TLSyncClient } from "@tldraw/sync-core";
import { PageRecordType } from "@tldraw/tlschema";

import { lessonSyncSchema } from "./schema.mjs";

const windowListeners = new EventTarget();
globalThis.window = windowListeners;
globalThis.window.navigator = { onLine: true };
globalThis.document = new EventTarget();
globalThis.document.hidden = false;
globalThis.document.visibilityState = "visible";
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 16);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

const ROOM = "a10a0e00-0000-4000-8000-000000000001";
const MARKER = "sleep-marker";
const DATA_DIR = process.env.TLDRAW_SYNC_DATA || "/var/lib/itflux/tldraw-sync";
const PORT = process.env.TLDRAW_SYNC_PORT || "5858";

function issueToken() {
  const secret = String(process.env.TLDRAW_SYNC_SECRET || "");
  if (!secret) throw new Error("TLDRAW_SYNC_SECRET missing");
  const payload = {
    board_id: ROOM,
    can_edit: true,
    exp: Math.floor(Date.now() / 1000) + 1800,
    user_id: 1,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${signature}`;
}

function presenceIds(store) {
  return store
    .allRecords()
    .filter((record) => record.typeName === "instance_presence")
    .map((record) => record.id);
}

function hasMarker(store) {
  return store.allRecords().some((record) => record.typeName === "page" && record.name === MARKER);
}

function connect(sessionId) {
  const store = new Store({ schema: lessonSyncSchema(), props: {} });
  const presence = atom("presence", null);
  let client;
  const socket = new ClientWebSocketAdapter(async () => {
    const token = issueToken();
    const url = new URL(`ws://127.0.0.1:${PORT}/ws/tldraw/${ROOM}/`);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("access_token", token);
    return url.toString();
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`load timeout ${sessionId}`)), 20000);
    client = new TLSyncClient({
      store,
      socket,
      presence,
      onLoad() {
        clearTimeout(timer);
        resolve({ client, store, socket });
      },
      onSyncError(reason) {
        clearTimeout(timer);
        reject(new Error(String(reason)));
      },
    });
  });
}

async function session(sessionId, { write }) {
  const opened = await connect(sessionId);
  if (write) {
    const page = PageRecordType.create({ name: MARKER, index: "a1" });
    opened.store.put([page]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } else {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  const report = {
    sessionId,
    room: ROOM,
    marker: hasMarker(opened.store),
    presence: presenceIds(opened.store),
    status: opened.socket.connectionStatus,
  };
  opened.client.close();
  opened.socket.close();
  return report;
}

function cleanup() {
  const file = path.join(DATA_DIR, `${ROOM}.sqlite`);
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
}

try {
  const opened = await connect("sleep-a");
  const page = PageRecordType.create({ name: MARKER, index: "a1" });
  opened.store.put([page]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!hasMarker(opened.store)) throw new Error("marker missing after write");
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  const background = {
    phase: "background",
    room: ROOM,
    marker: hasMarker(opened.store),
    presence: presenceIds(opened.store),
    status: opened.socket.connectionStatus,
    sameRoom: true,
  };
  console.log(JSON.stringify(background));
  if (!background.marker || background.status !== "online") throw new Error("background failed");
  const seenPresence = new Set(background.presence);
  opened.client.close();
  opened.socket.close();

  const results = [background];
  for (const [name, ms] of [
    ["offline", 30_000],
    ["sleep-2min", 120_000],
    ["sleep-10min", 600_000],
  ]) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const report = await session(`sleep-${name}`, { write: false });
    const replayed = report.presence.filter((id) => seenPresence.has(id));
    const row = { phase: name, ...report, replayed, sameRoom: report.room === ROOM };
    results.push(row);
    console.log(JSON.stringify(row));
    if (!row.marker || replayed.length) throw new Error(`${name} failed`);
  }
  console.log(JSON.stringify({ ok: true, results }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode || 1), 1000);
} finally {
  await new Promise((resolve) => setTimeout(resolve, 35_000));
  cleanup();
}
