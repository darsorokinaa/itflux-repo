import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { NodeSqliteWrapper, SQLiteSyncStorage, TLSocketRoom } from "@tldraw/sync-core";
import { createUserId } from "@tldraw/tlschema";
import { WebSocketServer } from "ws";

import { lessonSyncSchema } from "./schema.mjs";
import { verifySyncToken, peekSyncTokenClaims, clientIpFromRequest } from "./token.mjs";
import { backupRoomFile, mergeIntoRoom, unmergeRoom } from "./merge.mjs";

const ROOM_PATH = /^\/ws\/tldraw\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const DEV_SYNC_SECRET = "itflux-tldraw-sync-dev";
const IDLE_MS = 30_000;

function requestIdFromHeader(value) {
  if (typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value)) return value;
  return crypto.randomBytes(8).toString("hex");
}

function logWsLifecycle(fields) {
  const line = {
    event: fields.event,
    request_id: fields.request_id,
    user_id: fields.user_id || "",
    lesson_id: fields.lesson_id || "",
    board_id: fields.board_id || "",
    close_code: fields.close_code ?? "",
    ...(fields.ip ? { ip: fields.ip } : {}),
    ...(fields.result ? { result: fields.result } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ts: (Date.now() / 1000).toFixed(3),
  };
  if (fields.duration_s != null) line.duration_s = fields.duration_s;
  if (fields.last_activity_ts != null) line.last_activity_ts = fields.last_activity_ts;
  const text = JSON.stringify(line);
  if (/access_token|bearer |eyJ/i.test(text)) return;
  writeStdout(text);
}

let stdoutBlocked = false;
let stdoutDropped = 0;
process.stdout.on("drain", () => {
  stdoutBlocked = false;
  if (stdoutDropped > 0) {
    const dropped = stdoutDropped;
    stdoutDropped = 0;
    process.stdout.write(`${dropped} tldraw lifecycle lines dropped while stdout was blocked\n`);
  }
});

function writeStdout(text) {
  if (stdoutBlocked) {
    stdoutDropped += 1;
    return;
  }
  const ok = process.stdout.write(`${text}\n`);
  if (!ok) stdoutBlocked = true;
}

export function syncSecretFromEnv() {
  const secret = String(process.env.TLDRAW_SYNC_SECRET || "").trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") return "";
  return DEV_SYNC_SECRET;
}

function socketBridge(socket, slot) {
  const listeners = {
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };
  const emit = (type, event) => {
    // A replaced tab keeps the same session id. The old socket closes after the
    // new one is already in the room; forwarding that close cancels the live session.
    if (!slot.active) return;
    for (const handler of [...listeners[type]]) handler(event);
  };
  socket.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    if (process.env.TLDRAW_SYNC_DEBUG === "1") {
      console.log("ws message", text.slice(0, 160));
    }
    emit("message", { data: text });
  });
  socket.on("close", () => emit("close", {}));
  socket.on("error", () => emit("error", {}));
  return {
    get readyState() {
      return socket.readyState;
    },
    send(data) {
      if (!slot.active) return;
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    addEventListener(type, handler) {
      if (typeof handler !== "function") return;
      listeners[type]?.add(handler);
    },
    removeEventListener(type, handler) {
      listeners[type]?.delete(handler);
    },
  };
}

function bindPresenceUser(message, userId) {
  const presence = message?.presence;
  if (!userId || !Array.isArray(presence)) return;
  const [op, value] = presence;
  if (op === "put" && value && typeof value === "object") {
    value.userId = userId;
  } else if (op === "patch" && value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "userId")) {
    delete value.userId;
  }
}

export async function createSyncServer({ port = 5858, host = "127.0.0.1", secret, dataDir }) {
  if (!secret) throw new Error("TLDRAW_SYNC_SECRET is required");
  fs.mkdirSync(dataDir, { recursive: true });
  const schema = lessonSyncSchema();
  const rooms = new Map();
  const sessionUsers = new Map();
  const sessionSlots = new Map();

  function dropRoom(boardId) {
    const entry = rooms.get(boardId);
    if (!entry || entry.closing) return;
    entry.closing = true;
    rooms.delete(boardId);
    clearTimeout(entry.idle);
    try {
      entry.storage?.pruneTombstones?.cancel?.();
    } catch {
      /* throttle already idle */
    }
    try {
      entry.room.close();
    } catch {
      /* already closed */
    }
    try {
      entry.db.close();
    } catch {
      /* already closed */
    }
  }

  function roomFor(boardId) {
    const existing = rooms.get(boardId);
    if (existing) {
      clearTimeout(existing.idle);
      existing.idle = null;
      return existing.room;
    }
    const db = new DatabaseSync(path.join(dataDir, `${boardId}.sqlite`));
    let storage;
    try {
      storage = new SQLiteSyncStorage({ sql: new NodeSqliteWrapper(db) });
    } catch (error) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      throw error;
    }
    const entry = { db, storage, room: null, idle: null };
    entry.room = new TLSocketRoom({
      schema,
      storage,
      log: {
        error: (...args) => console.error("tldraw-sync", ...args),
      },
      onAfterReceiveMessage({ sessionId, message }) {
        bindPresenceUser(message, sessionUsers.get(sessionId));
      },
      onSessionRemoved(_room, info) {
        sessionUsers.delete(info.sessionId);
        if (info.numSessionsRemaining > 0) return;
        entry.idle = setTimeout(() => dropRoom(boardId), IDLE_MS);
      },
    });
    rooms.set(boardId, entry);
    return entry.room;
  }

  function releaseIfIdle(boardId) {
    const entry = rooms.get(boardId);
    if (!entry || entry.idle) return;
    if (entry.room.getSessions().length > 0) return;
    entry.idle = setTimeout(() => dropRoom(boardId), IDLE_MS);
  }

  const BOARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function internalAuthorized(req) {
    const got = Buffer.from(String(req.headers["x-itflux-sync-secret"] || ""));
    const want = Buffer.from(secret);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  function readJson(req, limit = 64 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  }
  function sendJson(res, code, body) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }
  function roomFileExists(boardId) {
    return fs.existsSync(path.join(dataDir, `${boardId}.sqlite`));
  }
  async function handleInternal(req, res) {
    if (req.method !== "POST" || !internalAuthorized(req)) return sendJson(res, 403, { detail: "forbidden" });
    const body = await readJson(req);
    const target = String(body.target || body.ids?.[0] || "").toLowerCase();
    if (!BOARD_ID.test(target)) return sendJson(res, 400, { detail: "bad target" });
    if (req.url === "/internal/room-status") {
      const ids = (Array.isArray(body.ids) ? body.ids : [target]).map((x) => String(x).toLowerCase()).filter((x) => BOARD_ID.test(x));
      const out = {};
      for (const id of ids) {
        const entry = rooms.get(id);
        let shapes = 0;
        if (entry) {
          shapes = entry.room.getCurrentSnapshot().documents.filter((d) => d.state?.typeName === "shape").length;
        } else if (roomFileExists(id)) {
          try {
            const ro = new DatabaseSync(path.join(dataDir, `${id}.sqlite`), { readOnly: true });
            try {
              for (const row of ro.prepare("SELECT state FROM documents").iterate()) {
                if (Buffer.from(row.state).includes('"typeName":"shape"')) shapes += 1;
              }
            } finally {
              ro.close();
            }
          } catch {
            shapes = -1;
          }
        }
        out[id] = { sessions: entry ? entry.room.getSessions().length : 0, file: roomFileExists(id), shapes };
      }
      return sendJson(res, 200, { rooms: out });
    }
    if (req.url === "/internal/merge") {
      const parts = Array.isArray(body.parts) ? body.parts : [];
      for (const part of parts) {
        part.source_id = String(part.source_id || "").toLowerCase();
        if (!BOARD_ID.test(part.source_id) || part.source_id === target) return sendJson(res, 400, { detail: "bad source" });
        if (part.kind === "room" && !roomFileExists(part.source_id)) return sendJson(res, 400, { detail: "no room for source" });
      }
      const mergeId = String(body.merge_id || "");
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(mergeId)) return sendJson(res, 400, { detail: "bad merge id" });
      const targetRoom = roomFor(target);
      try {
        const backup = backupRoomFile(rooms.get(target).db, dataDir, target);
        const touched = new Set();
        const result = await mergeIntoRoom({
          targetRoom,
          parts,
          urlMap: body.url_map || {},
          mergeId,
          snapshotOf: (id) => {
            touched.add(id);
            return roomFor(id).getCurrentSnapshot().documents.map((d) => d.state);
          },
        });
        for (const id of touched) releaseIfIdle(id);
        return sendJson(res, 200, { ...result, backup, sessions: targetRoom.getSessions().length });
      } finally {
        releaseIfIdle(target);
      }
    }
    if (req.url === "/internal/unmerge") {
      const mergeId = String(body.merge_id || "");
      if (!roomFileExists(target)) return sendJson(res, 404, { detail: "no room" });
      const targetRoom = roomFor(target);
      try {
        const backup = backupRoomFile(rooms.get(target).db, dataDir, target);
        const result = await unmergeRoom({ targetRoom, mergeId });
        return sendJson(res, 200, { ...result, backup });
      } finally {
        releaseIfIdle(target);
      }
    }
    return sendJson(res, 404, { detail: "unknown" });
  }

  const httpServer = http.createServer((req, res) => {
    if (req.url && req.url.startsWith("/internal/")) {
      handleInternal(req, res).catch((error) => {
        console.error("tldraw-sync internal failed", error);
        if (!res.headersSent) sendJson(res, 500, { detail: String(error?.message || error).slice(0, 300) });
      });
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  // r124: каждая попытка до рукопожатия и до проверки токена — кто, к какой доске, откуда.
  httpServer.on("upgrade", (request) => {
    let boardId = "";
    let claims = { state: "missing" };
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const match = url.pathname.match(ROOM_PATH);
      boardId = match ? match[1].toLowerCase() : "";
      claims = peekSyncTokenClaims(url.searchParams.get("access_token"));
    } catch {
      claims = { state: "bad_url" };
    }
    logWsLifecycle({
      event: "attempt",
      request_id: requestIdFromHeader(request.headers["x-request-id"]),
      user_id: claims.user_id || "",
      board_id: boardId,
      ip: clientIpFromRequest(request),
      result: "received",
      reason: `token_${claims.state}`,
    });
  });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket, request) => {
    const requestId = requestIdFromHeader(request.headers["x-request-id"]);
    const ip = clientIpFromRequest(request);
    let url;
    try {
      url = new URL(request.url || "/", "http://127.0.0.1");
    } catch {
      logWsLifecycle({ event: "disconnect", request_id: requestId, close_code: 4400, ip, result: "rejected", reason: "bad_url" });
      socket.close(4400, "bad request");
      return;
    }
    const match = url.pathname.match(ROOM_PATH);
    if (!match) {
      logWsLifecycle({ event: "disconnect", request_id: requestId, close_code: 4404, ip, result: "rejected", reason: "bad_path" });
      socket.close(4404, "unknown room");
      return;
    }
    const boardId = match[1].toLowerCase();
    const connectedAt = Date.now();
    let lastActivity = connectedAt;
    socket.on("message", () => {
      lastActivity = Date.now();
    });
    logWsLifecycle({ event: "connect", request_id: requestId, board_id: boardId });
    const rawToken = url.searchParams.get("access_token");
    const payload = verifySyncToken(rawToken, secret);
    if (!payload || String(payload.board_id).toLowerCase() !== boardId) {
      const claims = peekSyncTokenClaims(rawToken);
      logWsLifecycle({
        event: "disconnect",
        request_id: requestId,
        user_id: claims.user_id || "",
        board_id: boardId,
        close_code: 4401,
        ip,
        result: "unauthorized",
        reason: payload ? "board_mismatch" : (claims.state === "present" ? "bad_signature" : `token_${claims.state}`),
      });
      socket.close(4401, "unauthorized");
      return;
    }
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      logWsLifecycle({ event: "disconnect", request_id: requestId, user_id: payload.user_id ?? "", board_id: boardId, close_code: 4400, ip, result: "rejected", reason: "missing_session" });
      socket.close(4400, "missing session");
      return;
    }
    const presenceUserId = createUserId(String(payload.user_id ?? ""));
    logWsLifecycle({
      event: "authenticated",
      request_id: requestId,
      user_id: payload.user_id ?? "",
      board_id: boardId,
      ip,
      result: "ok",
    });
    sessionUsers.set(sessionId, presenceUserId);
    const slotKey = `${boardId}:${sessionId}`;
    const slot = { active: true };
    const previous = sessionSlots.get(slotKey);
    if (previous) previous.active = false;
    sessionSlots.set(slotKey, slot);
    try {
      roomFor(boardId).handleSocketConnect({
        sessionId,
        socket: socketBridge(socket, slot),
        isReadonly: !payload.can_edit,
      });
      logWsLifecycle({
        event: "room_joined",
        request_id: requestId,
        user_id: payload.user_id ?? "",
        board_id: boardId,
      });
    } catch (error) {
      slot.active = false;
      if (sessionSlots.get(slotKey) === slot) sessionSlots.delete(slotKey);
      sessionUsers.delete(sessionId);
      console.error("tldraw-sync room failed", error);
      logWsLifecycle({ event: "disconnect", request_id: requestId, board_id: boardId, close_code: 1011 });
      socket.close(1011, "room unavailable");
      return;
    }
    socket.on("close", (code) => {
      if (sessionSlots.get(slotKey) === slot) sessionSlots.delete(slotKey);
      const now = Date.now();
      logWsLifecycle({
        event: "disconnect",
        request_id: requestId,
        user_id: payload.user_id ?? "",
        board_id: boardId,
        close_code: code,
        duration_s: ((now - connectedAt) / 1000).toFixed(3),
        last_activity_ts: (lastActivity / 1000).toFixed(3),
      });
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, resolve);
  });
  return {
    port: httpServer.address().port,
    dataDir,
    close() {
      for (const boardId of [...rooms.keys()]) dropRoom(boardId);
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          /* already gone */
        }
      }
      wss.close();
      httpServer.close();
      httpServer.closeAllConnections?.();
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const secret = syncSecretFromEnv();
  if (!secret) {
    console.error("TLDRAW_SYNC_SECRET is required in production");
    process.exit(1);
  }
  const port = Number(process.env.TLDRAW_SYNC_PORT || 5858);
  const dataDir = process.env.TLDRAW_SYNC_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
  const running = await createSyncServer({ port, secret, dataDir });
  console.log(`tldraw sync listening on 127.0.0.1:${running.port}`);
}
