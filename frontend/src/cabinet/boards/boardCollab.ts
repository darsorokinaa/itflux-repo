/** WebSocket-синхронизация совместного редактирования доски. */

import { filesForLivePublish } from "./boardFiles";
import {
  applyBoardOps,
  buildLivePublishPayload,
  type BoardSceneOpsPayload,
} from "./boardOps";
import { mergeCollabScenes, type CollabScene } from "./boardSceneMerge";

export type { CollabScene } from "./boardSceneMerge";
export { mergeCollabScenes };
export type { BoardSceneOpsPayload };

/** Dev-only диагностика WS. Не пишет содержимое dataURL/base64. */
const BOARD_DEBUG = Boolean(import.meta.env?.DEV);
function boardWsLog(tag: string, data?: Record<string, unknown>) {
  if (!BOARD_DEBUG) return;
  // Строкой, а не вторым аргументом console.debug — иначе при копировании
  // текста консоли объект печатается как нераскрытое "Object".
  let json = "";
  try {
    json = data ? JSON.stringify(data) : "";
  } catch {
    json = "[unserializable]";
  }
  // eslint-disable-next-line no-console
  console.debug(`[board-ws] ${tag} ${json}`);
}

export type CollabPeer = {
  clientId: string;
  userId?: number | null;
  displayName: string;
  canEdit?: boolean;
  role?: "teacher" | "student" | "viewer" | string;
};

export type RemoteCursor = {
  clientId: string;
  userId?: number | null;
  displayName: string;
  role?: string;
  x: number;
  y: number;
  tool?: string;
  updatedAt: number;
};

export type CollabMessage =
  | { type: "ready"; board_id: string; can_edit: boolean; permission: string; role?: string }
  | { type: "presence_join"; client_id: string; user_id?: number; display_name?: string; can_edit?: boolean; role?: string }
  | { type: "presence_leave"; client_id: string; user_id?: number; display_name?: string }
  | { type: "scene_live"; client_id: string; user_id?: number; display_name?: string; version?: number; scene: CollabScene }
  | { type: "scene_ops"; client_id: string; user_id?: number; display_name?: string; version?: number; ops: BoardSceneOpsPayload }
  | { type: "scene_saved"; board_id?: string; version: number; scene: CollabScene; user_id?: number; display_name?: string; client_id?: string; cleared?: boolean }
  | {
      type: "file_add";
      client_id: string;
      user_id?: number;
      display_name?: string;
      files: Array<{ id: string; url: string; mimeType?: string; created?: number }>;
      elements?: unknown[];
    }
  | { type: "cursor_move"; client_id: string; user_id?: number; display_name?: string; role?: string; x?: number; y?: number; tool?: string }
  | { type: "cursor"; client_id: string; user_id?: number; display_name?: string; role?: string; x?: number; y?: number; tool?: string }
  | { type: "active_tool_change"; client_id: string; user_id?: number; display_name?: string; tool?: string }
  | { type: "pong"; t?: number }
  | { type: "error"; code?: string; detail?: string }
  | { type: "snapshot_request_ack"; board_id?: string; known_revision?: number };

type Handlers = {
  onReady?: (meta?: { canEdit?: boolean; permission?: string; role?: string }) => void;
  onPeersChange?: (peers: CollabPeer[]) => void;
  onRemoteScene?: (scene: CollabScene, meta: { version?: number; fromSaved?: boolean; clientId?: string; cleared?: boolean }) => void;
  onRemoteOps?: (ops: BoardSceneOpsPayload, meta: { version?: number; clientId?: string }) => void;
  onRemoteFileAdd?: (
    files: Array<{ id: string; url: string; mimeType?: string; created?: number }>,
    elements: unknown[],
    meta: { clientId?: string },
  ) => void;
  onRemoteCursor?: (cursor: RemoteCursor | null, clientId: string) => void;
  onRemoteTool?: (clientId: string, tool: string) => void;
  onStatus?: (status: "connecting" | "open" | "closed" | "error") => void;
  onResyncNeeded?: () => void;
};

function wsUrl(boardId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/interactive-boards/${boardId}/`;
}

export function createBoardCollabSession(
  boardId: string,
  displayName: string,
  handlers: Handlers = {},
  opts: { role?: string } = {},
) {
  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;
  let liveTimer: number | null = null;
  let pendingLive: CollabScene | null = null;
  let pendingVersion: number | undefined;
  let lastPublishedElements: unknown[] | null = null;
  let lastPresenceReplyAt = 0;
  let heartbeatTimer: number | null = null;
  let cursorRaf: number | null = null;
  let pendingCursor: { x: number; y: number; tool?: string } | null = null;
  let lastCursorSentAt = 0;
  let reconnectAttempt = 0;
  const CURSOR_MIN_INTERVAL_MS = 40; // ~25 Hz max
  /** Throttle промежуточных live-кадров (~30–60 мс). Финал — flushLiveNow(). */
  const LIVE_PUBLISH_INTERVAL_MS = 33;
  const peers = new Map<string, CollabPeer>();
  const selfRole = opts.role || "";
  const seenEventKeys = new Map<string, number>();
  const EVENT_DEDUP_TTL_MS = 8000;

  const emitPeers = () => {
    handlers.onPeersChange?.(Array.from(peers.values()));
  };

  const sendRaw = (payload: Record<string, unknown>) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };

  const sendJoin = () => {
    sendRaw({
      type: "join",
      client_id: clientId,
      display_name: displayName,
      role: selfRole,
    });
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer != null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      sendRaw({ type: "ping", t: Date.now() });
    }, 25000);
  };

  const connect = () => {
    if (closed) return;
    handlers.onStatus?.("connecting");
    boardWsLog("connecting", { boardId, clientId, attempt: reconnectAttempt });
    socket = new WebSocket(wsUrl(boardId));

    socket.onopen = () => {
      handlers.onStatus?.("open");
      boardWsLog("open", { boardId, clientId, reconnect: reconnectAttempt > 0 });
      sendJoin();
      startHeartbeat();
      handlers.onReady?.();
      if (reconnectAttempt > 0) {
        boardWsLog("resync after reconnect", { boardId, clientId, attempt: reconnectAttempt });
        sendRaw({
          type: "snapshot_request",
          client_id: clientId,
          known_revision: pendingVersion,
        });
        handlers.onResyncNeeded?.();
      }
      reconnectAttempt = 0;
    };

    socket.onmessage = (event) => {
      let data: CollabMessage;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;

      if (data.type === "ready") {
        handlers.onReady?.({
          canEdit: data.can_edit,
          permission: data.permission,
          role: data.role,
        });
        return;
      }

      if (data.type === "presence_join") {
        if (data.client_id === clientId) return;
        const isNew = !peers.has(data.client_id);
        peers.set(data.client_id, {
          clientId: data.client_id,
          userId: data.user_id,
          displayName: data.display_name || "Участник",
          canEdit: data.can_edit,
          role: data.role,
        });
        emitPeers();
        if (isNew) {
          const now = Date.now();
          if (now - lastPresenceReplyAt > 400) {
            lastPresenceReplyAt = now;
            sendJoin();
          }
        }
        return;
      }
      if (data.type === "presence_leave") {
        peers.delete(data.client_id);
        emitPeers();
        handlers.onRemoteCursor?.(null, data.client_id);
        return;
      }
      if (data.type === "cursor_move" || data.type === "cursor") {
        if (data.client_id === clientId) return;
        if (typeof data.x !== "number" || typeof data.y !== "number") return;
        if (!peers.has(data.client_id)) {
          peers.set(data.client_id, {
            clientId: data.client_id,
            userId: data.user_id,
            displayName: data.display_name || "Участник",
            role: data.role,
          });
          emitPeers();
        }
        handlers.onRemoteCursor?.(
          {
            clientId: data.client_id,
            userId: data.user_id,
            displayName: data.display_name || peers.get(data.client_id)?.displayName || "Участник",
            role: data.role || peers.get(data.client_id)?.role,
            x: data.x,
            y: data.y,
            tool: data.tool,
            updatedAt: Date.now(),
          },
          data.client_id,
        );
        return;
      }
      if (data.type === "active_tool_change") {
        if (data.client_id === clientId) return;
        handlers.onRemoteTool?.(data.client_id, String(data.tool || ""));
        return;
      }
      if (data.type === "file_add") {
        if (data.client_id === clientId) return;
        const files = Array.isArray(data.files) ? data.files : [];
        if (!files.length) return;
        boardWsLog("recv file_add", {
          fromClient: data.client_id,
          fileIds: files.map((f) => f.id),
          elementCount: Array.isArray(data.elements) ? data.elements.length : 0,
        });
        handlers.onRemoteFileAdd?.(files, Array.isArray(data.elements) ? data.elements : [], {
          clientId: data.client_id,
        });
        return;
      }
      if (data.type === "error") {
        boardWsLog("server error", { code: data.code, detail: data.detail });
        return;
      }
      if (data.type === "snapshot_request_ack") {
        boardWsLog("snapshot_request_ack", {
          boardId: data.board_id,
          knownRevision: data.known_revision,
        });
        return;
      }
      if (data.type === "scene_ops") {
        if (data.client_id === clientId) return;
        const ops = data.ops;
        if (!ops || !Array.isArray(ops.ops)) return;
        const dedupKey = `ops:${data.client_id}:${typeof data.version === "number" ? data.version : ""}:${ops.ops.length}:${String(event.data).length}`;
        const now = Date.now();
        const prevAt = seenEventKeys.get(dedupKey);
        if (prevAt && now - prevAt < EVENT_DEDUP_TTL_MS) {
          boardWsLog("skip duplicate scene_ops", { fromClient: data.client_id, version: data.version });
          return;
        }
        seenEventKeys.set(dedupKey, now);
        if (seenEventKeys.size > 200) {
          for (const [k, t] of seenEventKeys) {
            if (now - t > EVENT_DEDUP_TTL_MS) seenEventKeys.delete(k);
          }
        }
        boardWsLog("recv scene_ops", {
          fromClient: data.client_id,
          opsCount: ops.ops.length,
          fileIds: Object.keys(ops.files || {}),
          bytes: String(event.data).length,
        });
        handlers.onRemoteOps?.(ops, {
          version: typeof data.version === "number" ? data.version : undefined,
          clientId: data.client_id,
        });
        return;
      }
      if (data.type === "scene_live" || data.type === "scene_saved") {
        if (data.type === "scene_live" && data.client_id === clientId) return;
        const scene = data.scene;
        if (!scene || !Array.isArray(scene.elements)) return;
        boardWsLog(`recv ${data.type}`, {
          fromClient: "client_id" in data ? data.client_id : undefined,
          elementCount: scene.elements.length,
          fileIds: Object.keys(scene.files || {}),
          bytes: String(event.data).length,
          version: typeof data.version === "number" ? data.version : undefined,
        });
        handlers.onRemoteScene?.(
          {
            elements: scene.elements,
            appState: (scene.appState || {}) as Record<string, unknown>,
            files: (scene.files || {}) as Record<string, unknown>,
          },
          {
            version: typeof data.version === "number" ? data.version : undefined,
            fromSaved: data.type === "scene_saved",
            clientId: "client_id" in data ? data.client_id : undefined,
            cleared: data.type === "scene_saved" ? Boolean(data.cleared) : undefined,
          },
        );
      }
    };

    socket.onerror = () => {
      handlers.onStatus?.("error");
      boardWsLog("error", { boardId, clientId });
    };

    socket.onclose = () => {
      handlers.onStatus?.("closed");
      boardWsLog("closed", { boardId, clientId, willReconnect: !closed });
      stopHeartbeat();
      socket = null;
      if (closed) return;
      reconnectAttempt += 1;
      const delay = Math.min(8000, 800 + reconnectAttempt * 700);
      reconnectTimer = window.setTimeout(connect, delay);
    };
  };

  connect();

  const flushLive = () => {
    liveTimer = null;
    if (!pendingLive || !socket || socket.readyState !== WebSocket.OPEN) return;
    const built = buildLivePublishPayload(lastPublishedElements, pendingLive, pendingVersion);
    if (built.kind === "ops") {
      if (!built.payload.ops.length && !Object.keys(built.payload.files || {}).length) {
        pendingLive = null;
        return;
      }
      const payload = {
        type: "scene_ops",
        client_id: clientId,
        version: built.version,
        ops: {
          ...built.payload,
          files: filesForLivePublish(built.payload.files as Record<string, Record<string, unknown>>),
        },
      };
      boardWsLog("send scene_ops", {
        opsCount: built.payload.ops.length,
        fileIds: Object.keys(payload.ops.files || {}),
        version: built.version,
      });
      sendRaw(payload);
      lastPublishedElements = pendingLive.elements;
    } else {
      boardWsLog("send scene_live", {
        elementCount: built.scene.elements?.length || 0,
        fileIds: Object.keys(built.scene.files || {}),
        version: built.version,
      });
      sendRaw({
        type: "scene_live",
        client_id: clientId,
        version: built.version,
        scene: built.scene,
      });
      lastPublishedElements = built.scene.elements;
    }
    pendingLive = null;
  };

  const flushCursor = () => {
    cursorRaf = null;
    if (!pendingCursor) return;
    const now = Date.now();
    if (now - lastCursorSentAt < CURSOR_MIN_INTERVAL_MS) {
      cursorRaf = window.requestAnimationFrame(flushCursor);
      return;
    }
    const payload = pendingCursor;
    pendingCursor = null;
    lastCursorSentAt = now;
    sendRaw({
      type: "cursor_move",
      client_id: clientId,
      x: Math.round(payload.x * 10) / 10,
      y: Math.round(payload.y * 10) / 10,
      tool: payload.tool || "pointer",
    });
  };

  return {
    clientId,
    publishLive(scene: CollabScene, version?: number) {
      pendingLive = {
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
      };
      pendingVersion = version;
      if (liveTimer != null) return;
      liveTimer = window.setTimeout(flushLive, LIVE_PUBLISH_INTERVAL_MS);
    },
    /** Сразу отправить накопленный live (конец штриха / pointerup) — без debounce. */
    flushLiveNow() {
      if (liveTimer != null) {
        window.clearTimeout(liveTimer);
        liveTimer = null;
      }
      flushLive();
    },
    /** После полного resync — база для следующего diff. */
    resetPublishBase(elements: unknown[] | null | undefined) {
      lastPublishedElements = Array.isArray(elements) ? elements : null;
    },
    applyOpsLocally(local: CollabScene, ops: BoardSceneOpsPayload): CollabScene {
      return applyBoardOps(local, ops);
    },
    publishCursor(x: number, y: number, tool = "pointer") {
      pendingCursor = { x, y, tool };
      if (cursorRaf != null) return;
      cursorRaf = window.requestAnimationFrame(flushCursor);
    },
    publishActiveTool(tool: string) {
      sendRaw({
        type: "active_tool_change",
        client_id: clientId,
        tool: String(tool || "").slice(0, 64),
      });
    },
    /**
     * После HTTP-аплоада: сообщить пирам стабильные URL + image-элементы.
     * Без blob/base64. Пир обязан addFiles до updateScene(elements).
     */
    publishFileAdd(
      files: Array<{ id: string; url: string; mimeType?: string; created?: number }>,
      elements: unknown[] = [],
    ) {
      const clean = (files || [])
        .filter((f) => f && f.id && f.url && !String(f.url).startsWith("blob:") && !String(f.url).startsWith("data:"))
        .map((f) => ({
          id: String(f.id).slice(0, 128),
          url: String(f.url).slice(0, 2048),
          mimeType: String(f.mimeType || "image/png").slice(0, 64),
          created: typeof f.created === "number" ? f.created : Date.now(),
        }));
      if (!clean.length) return false;
      boardWsLog("send file_add", {
        fileIds: clean.map((f) => f.id),
        elementCount: Array.isArray(elements) ? elements.length : 0,
      });
      return sendRaw({
        type: "file_add",
        client_id: clientId,
        files: clean,
        elements: Array.isArray(elements) ? elements.slice(0, 50) : [],
      });
    },
    close() {
      closed = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      if (liveTimer != null) window.clearTimeout(liveTimer);
      if (cursorRaf != null) window.cancelAnimationFrame(cursorRaf);
      stopHeartbeat();
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
      peers.clear();
    },
  };
}
