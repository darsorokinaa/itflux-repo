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
import { verifySyncToken } from "./token.mjs";

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

function socketBridge(socket) {
  return {
    get readyState() {
      return socket.readyState;
    },
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    addEventListener(type, handler) {
      if (type === "message") {
        socket.on("message", (data) => {
          const text = typeof data === "string" ? data : data.toString("utf8");
          if (process.env.TLDRAW_SYNC_DEBUG === "1") {
            console.log("ws message", text.slice(0, 160));
          }
          handler({ data: text });
        });
      } else if (type === "close") {
        socket.on("close", () => handler({}));
      } else if (type === "error") {
        socket.on("error", () => handler({}));
      }
    },
    removeEventListener() {},
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

  const httpServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket, request) => {
    const requestId = requestIdFromHeader(request.headers["x-request-id"]);
    let url;
    try {
      url = new URL(request.url || "/", "http://127.0.0.1");
    } catch {
      logWsLifecycle({ event: "disconnect", request_id: requestId, close_code: 4400 });
      socket.close(4400, "bad request");
      return;
    }
    const match = url.pathname.match(ROOM_PATH);
    if (!match) {
      logWsLifecycle({ event: "disconnect", request_id: requestId, close_code: 4404 });
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
    const payload = verifySyncToken(url.searchParams.get("access_token"), secret);
    if (!payload || String(payload.board_id).toLowerCase() !== boardId) {
      logWsLifecycle({ event: "disconnect", request_id: requestId, board_id: boardId, close_code: 4401 });
      socket.close(4401, "unauthorized");
      return;
    }
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      logWsLifecycle({ event: "disconnect", request_id: requestId, board_id: boardId, close_code: 4400 });
      socket.close(4400, "missing session");
      return;
    }
    const presenceUserId = createUserId(String(payload.user_id ?? ""));
    logWsLifecycle({
      event: "authenticated",
      request_id: requestId,
      user_id: payload.user_id ?? "",
      board_id: boardId,
    });
    sessionUsers.set(sessionId, presenceUserId);
    try {
      roomFor(boardId).handleSocketConnect({
        sessionId,
        socket: socketBridge(socket),
        isReadonly: !payload.can_edit,
      });
      logWsLifecycle({
        event: "room_joined",
        request_id: requestId,
        user_id: payload.user_id ?? "",
        board_id: boardId,
      });
    } catch (error) {
      sessionUsers.delete(sessionId);
      console.error("tldraw-sync room failed", error);
      logWsLifecycle({ event: "disconnect", request_id: requestId, board_id: boardId, close_code: 1011 });
      socket.close(1011, "room unavailable");
      return;
    }
    socket.on("close", (code) => {
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
