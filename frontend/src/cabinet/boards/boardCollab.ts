/** WebSocket-синхронизация совместного редактирования доски. */

import { filesForLivePublish } from "./boardFiles";
import { reportClientEvent } from "../../utils/clientTelemetry";
import {
  applyBoardOps,
  buildLivePublishPayload,
  cloneBoardElement,
  type BoardSceneOpsPayload,
} from "./boardOps";
import { mergeCollabScenes, type CollabScene } from "./boardSceneMerge";
import {
  normalizeViewportPayload,
  type TeacherViewport,
} from "./boardViewport";

export type { CollabScene } from "./boardSceneMerge";
export { mergeCollabScenes };
export type { BoardSceneOpsPayload };
export type { TeacherViewport };

/** Dev-only диагностика WS. Не пишет содержимое dataURL/base64. */
const BOARD_DEBUG = Boolean(import.meta.env?.DEV);
/** Кратковременные метрики latency (вкл. через localStorage.itflux_board_sync_debug=1). */
function boardSyncDebugEnabled(): boolean {
  if (BOARD_DEBUG) return true;
  try {
    return window.localStorage?.getItem("itflux_board_sync_debug") === "1";
  } catch {
    return false;
  }
}
function boardWsLog(tag: string, data?: Record<string, unknown>) {
  if (!boardSyncDebugEnabled()) return;
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

/**
 * Excalidraw мутирует элементы in-place. Для diff нужна копия полей версии
 * и points — иначе prev и next делят один points[] и elKey «не меняется».
 */
function snapshotElementsForDiff(elements: unknown[] | null | undefined): unknown[] | null {
  if (!Array.isArray(elements)) return null;
  return elements.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    return cloneBoardElement(raw as Record<string, unknown>);
  });
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
  | { type: "scene_live"; client_id: string; user_id?: number; display_name?: string; version?: number; scene: CollabScene; t_sent?: number; seq?: number }
  | { type: "scene_ops"; client_id: string; user_id?: number; display_name?: string; version?: number; ops: BoardSceneOpsPayload; t_sent?: number; seq?: number }
  | { type: "scene_saved"; board_id?: string; version: number; scene?: CollabScene; user_id?: number; display_name?: string; client_id?: string; cleared?: boolean; lite?: boolean; element_count?: number }
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
  | {
      type: "paper_style";
      client_id: string;
      user_id?: number;
      display_name?: string;
      role?: string;
      style: string;
      bgColor: string;
    }
  | { type: "paper_request"; client_id: string }
  | {
      type: "viewport_update";
      client_id: string;
      user_id?: number;
      display_name?: string;
      role?: string;
      scrollX: number;
      scrollY: number;
      zoom: number;
      width?: number;
      height?: number;
      seq?: number;
      t_sent?: number;
    }
  | {
      type: "viewport_state";
      client_id: string;
      user_id?: number;
      display_name?: string;
      role?: string;
      scrollX: number;
      scrollY: number;
      zoom: number;
      width?: number;
      height?: number;
      seq?: number;
      t_sent?: number;
    }
  | { type: "viewport_request"; client_id: string }
  | {
      type: "sync_probe";
      client_id: string;
      probe_id: string;
      t_sent?: number;
      t_server?: number;
    }
  | {
      type: "sync_probe_ack";
      client_id: string;
      probe_id: string;
      t_sent?: number;
      t_server?: number;
      t_recv?: number;
      echo?: boolean;
    }
  | { type: "pong"; t?: number }
  | { type: "error"; code?: string; detail?: string }
  | { type: "snapshot_request_ack"; board_id?: string; known_revision?: number };

export type SyncProbeResult = {
  probeId: string;
  /** client → server → client (echo), мс */
  rttEchoMs: number | null;
  /** client → server (one-way estimate from t_server - t_sent; clock skew possible) */
  toServerMs: number | null;
  tSent: number;
  tServer: number | null;
  tAck: number;
};

type Handlers = {
  onReady?: (meta?: { canEdit?: boolean; permission?: string; role?: string }) => void;
  onPeersChange?: (peers: CollabPeer[]) => void;
  onRemoteScene?: (
    scene: CollabScene,
    meta: { version?: number; fromSaved?: boolean; clientId?: string; cleared?: boolean; lite?: boolean },
  ) => void;
  onRemoteOps?: (ops: BoardSceneOpsPayload, meta: { version?: number; clientId?: string }) => void;
  onRemoteFileAdd?: (
    files: Array<{ id: string; url: string; mimeType?: string; created?: number }>,
    elements: unknown[],
    meta: { clientId?: string },
  ) => void;
  onRemoteCursor?: (cursor: RemoteCursor | null, clientId: string) => void;
  onRemoteTool?: (clientId: string, tool: string) => void;
  onRemoteViewport?: (viewport: TeacherViewport) => void;
  onStatus?: (status: "connecting" | "open" | "closed" | "error") => void;
  onResyncNeeded?: () => void;
  /** Учитель: ответить актуальным viewport новому участнику. */
  onViewportRequest?: (fromClientId: string) => void;
  /** Бумага (клетки/линии/точки/цвет) — shared appearance. */
  onRemotePaperStyle?: (paper: { style: string; bgColor: string }) => void;
  /** Учитель: отдать текущую бумагу запросившему. */
  onPaperRequest?: (fromClientId: string) => void;
  onSyncProbeResult?: (result: SyncProbeResult) => void;
};

function wsUrl(boardId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/interactive-boards/${boardId}/`;
}

function isSocketLive(ws: WebSocket | null): boolean {
  return Boolean(
    ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN),
  );
}

/** Exponential backoff for board WS reconnect. attempt is 1-based. */
export const BOARD_RECONNECT = {
  BASE_MS: 1000,
  FACTOR: 1.6,
  MAX_MS: 8000,
  JITTER: 0.2,
  MAX_ATTEMPT: 8,
  PONG_STALE_MS: 40000,
  HIDDEN_RESUME_MS: 5000,
  LARGE_PAYLOAD_BYTES: 80_000,
};

export function boardReconnectDelayMs(attempt: number, random = Math.random): number {
  const n = Math.max(1, Math.min(Number(attempt) || 1, BOARD_RECONNECT.MAX_ATTEMPT));
  const base = Math.min(
    BOARD_RECONNECT.MAX_MS,
    Math.round(BOARD_RECONNECT.BASE_MS * BOARD_RECONNECT.FACTOR ** (n - 1)),
  );
  const jitterMul = 1 + (random() * 2 - 1) * BOARD_RECONNECT.JITTER;
  const delay = Math.round(base * jitterMul);
  const floor = Math.round(BOARD_RECONNECT.BASE_MS * (1 - BOARD_RECONNECT.JITTER));
  const ceil = Math.round(BOARD_RECONNECT.MAX_MS * (1 + BOARD_RECONNECT.JITTER));
  return Math.max(floor, Math.min(ceil, delay));
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
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
  let lastLiveSentAt = 0;
  let reconnectAttempt = 0;
  let lastPingAt = 0;
  let lastPongAt = 0;
  let lastHiddenAt = 0;
  let lastCloseCode: number | null = null;
  let payloadSizes: number[] = [];
  let bytesWindowStart = Date.now();
  let bytesWindowTotal = 0;
  let messagesWindowTotal = 0;
  let viewportTimer: number | null = null;
  let pendingViewport: {
    scrollX: number;
    scrollY: number;
    zoom: number;
    width?: number;
    height?: number;
  } | null = null;
  let pendingViewportImmediate = false;
  let lastViewportSentAt = 0;
  let viewportSeq = 0;
  let liveSeq = 0;
  const pendingProbes = new Map<
    string,
    { tSent: number; resolve: (r: SyncProbeResult) => void; timer: number; gotEcho?: boolean }
  >();
  const CURSOR_MIN_INTERVAL_MS = 40; // ~25 Hz max
  /** Throttle промежуточных live-кадров. Финал — flushLiveNow(). */
  const LIVE_PUBLISH_INTERVAL_MS = 24;
  const VIEWPORT_MIN_INTERVAL_MS = 50;
  const peers = new Map<string, CollabPeer>();
  const selfRole = opts.role || "";
  const seenEventKeys = new Map<string, number>();
  const EVENT_DEDUP_TTL_MS = 8000;

  const emitPeers = () => {
    handlers.onPeersChange?.(Array.from(peers.values()));
  };

  const sendRaw = (payload: Record<string, unknown>) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      const raw = JSON.stringify(payload);
      socket.send(raw);
      notePayload(raw.length, String(payload.type || ""));
      return true;
    } catch {
      forceReconnect("send-failed");
      return false;
    }
  };

  const notePayload = (bytes: number, type: string) => {
    const now = Date.now();
    if (now - bytesWindowStart > 1000) {
      bytesWindowStart = now;
      bytesWindowTotal = 0;
      messagesWindowTotal = 0;
    }
    bytesWindowTotal += bytes;
    messagesWindowTotal += 1;
    payloadSizes.push(bytes);
    if (payloadSizes.length > 80) payloadSizes = payloadSizes.slice(-80);
    if (bytes >= BOARD_RECONNECT.LARGE_PAYLOAD_BYTES) {
      reportClientEvent("board_payload_large", {
        bytes,
        type: type.slice(0, 32),
        elementsHint: 0,
      });
    }
  };

  const payloadStats = () => {
    const sorted = [...payloadSizes].sort((a, b) => a - b);
    return {
      messagesPerSec: messagesWindowTotal,
      bytesPerSec: bytesWindowTotal,
      payloadP50: percentile(sorted, 50),
      payloadP95: percentile(sorted, 95),
      payloadMax: sorted.length ? sorted[sorted.length - 1] : 0,
    };
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

  const clearReconnectTimer = () => {
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const detachSocket = (ws: WebSocket | null) => {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  };

  const isPongStale = () => {
    if (!lastPongAt) return false;
    return Date.now() - lastPongAt > BOARD_RECONNECT.PONG_STALE_MS;
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      const now = Date.now();
      if (lastPongAt && now - lastPongAt > BOARD_RECONNECT.PONG_STALE_MS) {
        forceReconnect("pong-timeout");
        return;
      }
      lastPingAt = now;
      sendRaw({ type: "ping", t: now });
    }, 25000);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer != null) return;
    if (isSocketLive(socket)) return;
    reconnectAttempt = Math.min(reconnectAttempt + 1, BOARD_RECONNECT.MAX_ATTEMPT);
    const delay = boardReconnectDelayMs(reconnectAttempt);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (closed) return;
      if (isSocketLive(socket)) return;
      connect();
    }, delay);
  };

  const forceReconnect = (reason = "manual") => {
    if (closed) return;
    if (reason === "visibility" || reason === "pageshow" || reason === "online" || reason === "resume") {
      reconnectAttempt = 0;
    }
    clearReconnectTimer();
    const ws = socket;
    socket = null;
    stopHeartbeat();
    detachSocket(ws);
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    handlers.onStatus?.("connecting");
    reportClientEvent("board_ws_reconnect", { reason: String(reason).slice(0, 32) });
    connect();
  };

  const resumeIfNeeded = (reason: string) => {
    if (closed) return;
    if (reason === "visibility" && document.visibilityState === "hidden") {
      lastHiddenAt = Date.now();
      return;
    }
    const hiddenMs = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
    lastHiddenAt = 0;
    const live = isSocketLive(socket);
    const frozenOpen = live && hiddenMs >= BOARD_RECONNECT.HIDDEN_RESUME_MS;
    if (!live || isPongStale() || frozenOpen) {
      forceReconnect(reason);
      return;
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      lastPingAt = Date.now();
      sendRaw({ type: "ping", t: lastPingAt });
    }
  };

  const connect = () => {
    if (closed) return;
    if (isSocketLive(socket)) return;
    clearReconnectTimer();
    if (socket) {
      detachSocket(socket);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      socket = null;
    }
    handlers.onStatus?.("connecting");
    boardWsLog("connecting", { boardId, clientId, attempt: reconnectAttempt });
    const ws = new WebSocket(wsUrl(boardId));
    socket = ws;

    ws.onopen = () => {
      if (closed || socket !== ws) return;
      handlers.onStatus?.("open");
      boardWsLog("open", { boardId, clientId, reconnect: reconnectAttempt > 0 });
      lastPongAt = Date.now();
      lastHiddenAt = 0;
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
      clearReconnectTimer();
    };

    ws.onmessage = (event) => {
      if (closed || socket !== ws) return;
      let data: CollabMessage;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;

      if (data.type === "pong") {
        lastPongAt = Date.now();
        return;
      }

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
      if (data.type === "viewport_update" || data.type === "viewport_state") {
        if (data.client_id === clientId) return;
        const vp = normalizeViewportPayload(
          {
            scrollX: data.scrollX,
            scrollY: data.scrollY,
            zoom: data.zoom,
            width: data.width,
            height: data.height,
            seq: data.seq,
            role: data.role,
          },
          data.client_id,
          data.user_id,
          data.role,
        );
        if (!vp) return;
        // Follow-target — только учитель (роль со сервера / presence).
        const role = String(vp.role || peers.get(data.client_id)?.role || "");
        if (role !== "teacher") return;
        if (!peers.has(data.client_id)) {
          peers.set(data.client_id, {
            clientId: data.client_id,
            userId: data.user_id,
            displayName: data.display_name || "Участник",
            role: data.role,
          });
          emitPeers();
        }
        if (typeof data.t_sent === "number" && boardSyncDebugEnabled()) {
          boardWsLog("recv viewport latency", {
            fromClient: data.client_id,
            ms: Date.now() - data.t_sent,
            seq: data.seq,
          });
        }
        handlers.onRemoteViewport?.(vp);
        return;
      }
      if (data.type === "viewport_request") {
        if (data.client_id === clientId) return;
        handlers.onViewportRequest?.(data.client_id);
        return;
      }
      if (data.type === "paper_style") {
        if (data.client_id === clientId) return;
        handlers.onRemotePaperStyle?.({
          style: String(data.style || "none"),
          bgColor: String(data.bgColor || "#ffffff"),
        });
        return;
      }
      if (data.type === "paper_request") {
        if (data.client_id === clientId) return;
        handlers.onPaperRequest?.(data.client_id);
        return;
      }
      if (data.type === "sync_probe") {
        if (data.client_id === clientId) return;
        // Пир отвечает ack — инициатор меряет путь client→peer→client.
        sendRaw({
          type: "sync_probe_ack",
          client_id: clientId,
          probe_id: data.probe_id,
          t_sent: data.t_sent,
          t_server: data.t_server,
          t_recv: Date.now(),
        });
        return;
      }
      if (data.type === "sync_probe_ack") {
        const pending = pendingProbes.get(data.probe_id);
        if (!pending) return;
        // Предпочитаем server echo; peer-ack только если echo ещё не пришёл.
        if (!data.echo && pending.gotEcho) return;
        if (data.echo) {
          pending.gotEcho = true;
        }
        window.clearTimeout(pending.timer);
        pendingProbes.delete(data.probe_id);
        const tAck = Date.now();
        const tServer = typeof data.t_server === "number" ? data.t_server : null;
        const result: SyncProbeResult = {
          probeId: data.probe_id,
          rttEchoMs: tAck - pending.tSent,
          toServerMs: tServer != null ? tServer - pending.tSent : null,
          tSent: pending.tSent,
          tServer,
          tAck,
        };
        boardWsLog("sync_probe result", {
          probeId: result.probeId,
          rttEchoMs: result.rttEchoMs,
          toServerMs: result.toServerMs,
          echo: Boolean(data.echo),
        });
        pending.resolve(result);
        handlers.onSyncProbeResult?.(result);
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
        if (typeof data.t_sent === "number" && boardSyncDebugEnabled()) {
          boardWsLog("recv scene_ops latency", {
            fromClient: data.client_id,
            ms: Date.now() - data.t_sent,
            opsCount: ops.ops.length,
            bytes: String(event.data).length,
            seq: data.seq,
          });
        } else {
          boardWsLog("recv scene_ops", {
            fromClient: data.client_id,
            opsCount: ops.ops.length,
            fileIds: Object.keys(ops.files || {}),
            bytes: String(event.data).length,
          });
        }
        handlers.onRemoteOps?.(ops, {
          version: typeof data.version === "number" ? data.version : undefined,
          clientId: data.client_id,
        });
        return;
      }
      if (data.type === "scene_live" || data.type === "scene_saved") {
        if (data.type === "scene_live" && data.client_id === clientId) return;
        // Lite scene_saved: только version bump — без тяжёлого apply полной сцены.
        if (data.type === "scene_saved" && data.lite) {
          boardWsLog("recv scene_saved lite", {
            version: data.version,
            elementCount: data.element_count,
          });
          handlers.onRemoteScene?.(
            { elements: [], appState: {}, files: {} },
            {
              version: typeof data.version === "number" ? data.version : undefined,
              fromSaved: true,
              clientId: data.client_id,
              cleared: Boolean(data.cleared),
              lite: true,
            },
          );
          return;
        }
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
            lite: false,
          },
        );
      }
    };

    ws.onerror = () => {
      if (closed || socket !== ws) return;
      handlers.onStatus?.("error");
      boardWsLog("error", { boardId, clientId });
    };

    ws.onclose = (event) => {
      lastCloseCode = typeof event?.code === "number" ? event.code : null;
      boardWsLog("closed", { boardId, clientId, willReconnect: !closed, code: lastCloseCode });
      if (socket === ws) {
        stopHeartbeat();
        socket = null;
      }
      if (closed) return;
      if (isSocketLive(socket)) return;
      handlers.onStatus?.("closed");
      reportClientEvent("board_ws_closed", {
        code: lastCloseCode,
        reason: String(event?.reason || "").slice(0, 64),
        attempt: reconnectAttempt,
      });
      scheduleReconnect();
    };
  };

  connect();

  const onVisibility = () => resumeIfNeeded("visibility");
  const onPageShow = () => resumeIfNeeded("pageshow");
  const onOnline = () => resumeIfNeeded("online");
  const onResume = () => resumeIfNeeded("resume");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("online", onOnline);
  window.addEventListener("resume", onResume);

  const flushLive = () => {
    liveTimer = null;
    if (!pendingLive || !socket || socket.readyState !== WebSocket.OPEN) return;
    const built = buildLivePublishPayload(lastPublishedElements, pendingLive, pendingVersion);
    liveSeq += 1;
    const tSent = Date.now();
    if (built.kind === "ops") {
      if (!built.payload.ops.length && !Object.keys(built.payload.files || {}).length) {
        pendingLive = null;
        return;
      }
      const payload = {
        type: "scene_ops",
        client_id: clientId,
        version: built.version,
        seq: liveSeq,
        t_sent: tSent,
        ops: {
          ...built.payload,
          files: filesForLivePublish(built.payload.files as Record<string, Record<string, unknown>>),
        },
      };
      boardWsLog("send scene_ops", {
        opsCount: built.payload.ops.length,
        fileIds: Object.keys(payload.ops.files || {}),
        version: built.version,
        seq: liveSeq,
      });
      sendRaw(payload);
    } else {
      boardWsLog("send scene_live", {
        elementCount: built.scene.elements?.length || 0,
        fileIds: Object.keys(built.scene.files || {}),
        version: built.version,
        seq: liveSeq,
      });
      sendRaw({
        type: "scene_live",
        client_id: clientId,
        version: built.version,
        seq: liveSeq,
        t_sent: tSent,
        scene: built.scene,
      });
    }
    // Снимок, не live-ссылка: Excalidraw мутирует элементы in-place (version++),
    // иначе следующий diff сравнивает массив сам с собой и ops пустые.
    lastPublishedElements = snapshotElementsForDiff(pendingLive.elements);
    pendingLive = null;
    lastLiveSentAt = Date.now();
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

  const flushViewport = () => {
    viewportTimer = null;
    if (!pendingViewport || !socket || socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const force = pendingViewportImmediate;
    if (!force && now - lastViewportSentAt < VIEWPORT_MIN_INTERVAL_MS) {
      viewportTimer = window.setTimeout(
        flushViewport,
        VIEWPORT_MIN_INTERVAL_MS - (now - lastViewportSentAt),
      );
      return;
    }
    const vp = pendingViewport;
    pendingViewport = null;
    pendingViewportImmediate = false;
    lastViewportSentAt = now;
    viewportSeq += 1;
    sendRaw({
      type: "viewport_update",
      client_id: clientId,
      scrollX: Math.round(vp.scrollX * 100) / 100,
      scrollY: Math.round(vp.scrollY * 100) / 100,
      zoom: Math.round(vp.zoom * 10000) / 10000,
      width: vp.width,
      height: vp.height,
      seq: viewportSeq,
      t_sent: now,
      immediate: force,
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
      const elapsed = Date.now() - lastLiveSentAt;
      if (elapsed >= LIVE_PUBLISH_INTERVAL_MS) {
        flushLive();
        return;
      }
      liveTimer = window.setTimeout(flushLive, LIVE_PUBLISH_INTERVAL_MS - elapsed);
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
      lastPublishedElements = snapshotElementsForDiff(elements);
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
     * Viewport учителя (scroll/zoom). Отдельно от курсора и элементов.
     * Не сохраняется в БД на backend.
     */
    publishViewport(vp: {
      scrollX: number;
      scrollY: number;
      zoom: number;
      width?: number;
      height?: number;
    }, opts: { immediate?: boolean } = {}) {
      pendingViewport = {
        scrollX: vp.scrollX,
        scrollY: vp.scrollY,
        zoom: vp.zoom > 0 ? vp.zoom : 1,
        width: vp.width,
        height: vp.height,
      };
      if (opts.immediate) {
        pendingViewportImmediate = true;
        if (viewportTimer != null) {
          window.clearTimeout(viewportTimer);
          viewportTimer = null;
        }
        flushViewport();
        return;
      }
      if (viewportTimer != null) return;
      const elapsed = Date.now() - lastViewportSentAt;
      if (elapsed >= VIEWPORT_MIN_INTERVAL_MS) {
        flushViewport();
        return;
      }
      viewportTimer = window.setTimeout(flushViewport, VIEWPORT_MIN_INTERVAL_MS - elapsed);
    },
    /** Запросить актуальный viewport учителя (при включении слежения). */
    requestViewport() {
      sendRaw({ type: "viewport_request", client_id: clientId });
    },
    /** Бумага доски (клетки / линии / точки / цвет) — сразу всем пирам. */
    publishPaperStyle(paper: { style: string; bgColor: string }) {
      sendRaw({
        type: "paper_style",
        client_id: clientId,
        style: String(paper.style || "none").slice(0, 16),
        bgColor: String(paper.bgColor || "#ffffff").slice(0, 32),
      });
    },
    requestPaperStyle() {
      sendRaw({ type: "paper_request", client_id: clientId });
    },
    /**
     * Измерить RTT комнаты (server echo). Без второго клиента.
     * При наличии пира он тоже отвечает — берётся первый ack.
     */
    runSyncProbe(timeoutMs = 3000): Promise<SyncProbeResult> {
      const probeId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tSent = Date.now();
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          pendingProbes.delete(probeId);
          resolve({
            probeId,
            rttEchoMs: null,
            toServerMs: null,
            tSent,
            tServer: null,
            tAck: Date.now(),
          });
        }, timeoutMs);
        pendingProbes.set(probeId, { tSent, resolve, timer });
        const ok = sendRaw({
          type: "sync_probe",
          client_id: clientId,
          probe_id: probeId,
          t_sent: tSent,
        });
        if (!ok) {
          window.clearTimeout(timer);
          pendingProbes.delete(probeId);
          resolve({
            probeId,
            rttEchoMs: null,
            toServerMs: null,
            tSent,
            tServer: null,
            tAck: Date.now(),
          });
        }
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
      clearReconnectTimer();
      if (liveTimer != null) window.clearTimeout(liveTimer);
      if (viewportTimer != null) window.clearTimeout(viewportTimer);
      if (cursorRaf != null) window.cancelAnimationFrame(cursorRaf);
      for (const [, p] of pendingProbes) window.clearTimeout(p.timer);
      pendingProbes.clear();
      stopHeartbeat();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("resume", onResume);
      const ws = socket;
      socket = null;
      detachSocket(ws);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      peers.clear();
    },
    resumeNow() {
      resumeIfNeeded("manual");
    },
    getDiagnostics() {
      return {
        connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
        reconnectAttempt,
        lastCloseCode,
        lastPingAt,
        lastPongAt,
        ...payloadStats(),
      };
    },
  };
}
