/** WebSocket-синхронизация совместного редактирования доски. */

import { filesForLivePublish } from "./boardFiles";
import { mergeCollabScenes, type CollabScene } from "./boardSceneMerge";

export type { CollabScene } from "./boardSceneMerge";
export { mergeCollabScenes };

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
  | { type: "scene_saved"; board_id?: string; version: number; scene: CollabScene; user_id?: number; display_name?: string; client_id?: string }
  | { type: "cursor_move"; client_id: string; user_id?: number; display_name?: string; role?: string; x?: number; y?: number; tool?: string }
  | { type: "cursor"; client_id: string; user_id?: number; display_name?: string; role?: string; x?: number; y?: number; tool?: string }
  | { type: "active_tool_change"; client_id: string; user_id?: number; display_name?: string; tool?: string }
  | { type: "pong"; t?: number };

type Handlers = {
  onReady?: (meta?: { canEdit?: boolean; permission?: string; role?: string }) => void;
  onPeersChange?: (peers: CollabPeer[]) => void;
  onRemoteScene?: (scene: CollabScene, meta: { version?: number; fromSaved?: boolean; clientId?: string }) => void;
  onRemoteCursor?: (cursor: RemoteCursor | null, clientId: string) => void;
  onRemoteTool?: (clientId: string, tool: string) => void;
  onStatus?: (status: "connecting" | "open" | "closed" | "error") => void;
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
  let lastPresenceReplyAt = 0;
  let heartbeatTimer: number | null = null;
  let cursorRaf: number | null = null;
  let pendingCursor: { x: number; y: number; tool?: string } | null = null;
  const peers = new Map<string, CollabPeer>();
  const selfRole = opts.role || "";

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
    socket = new WebSocket(wsUrl(boardId));

    socket.onopen = () => {
      handlers.onStatus?.("open");
      sendJoin();
      startHeartbeat();
      handlers.onReady?.();
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
      if (data.type === "scene_live" || data.type === "scene_saved") {
        if (data.type === "scene_live" && data.client_id === clientId) return;
        const scene = data.scene;
        if (!scene || !Array.isArray(scene.elements)) return;
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
          },
        );
      }
    };

    socket.onerror = () => {
      handlers.onStatus?.("error");
    };

    socket.onclose = () => {
      handlers.onStatus?.("closed");
      stopHeartbeat();
      socket = null;
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 1500);
    };
  };

  connect();

  const flushLive = () => {
    liveTimer = null;
    if (!pendingLive || !socket || socket.readyState !== WebSocket.OPEN) return;
    const scene = {
      elements: pendingLive.elements,
      appState: pendingLive.appState,
      files: filesForLivePublish(pendingLive.files as Record<string, Record<string, unknown>>),
    };
    sendRaw({
      type: "scene_live",
      client_id: clientId,
      version: pendingVersion,
      scene,
    });
    pendingLive = null;
  };

  const flushCursor = () => {
    cursorRaf = null;
    if (!pendingCursor) return;
    const payload = pendingCursor;
    pendingCursor = null;
    sendRaw({
      type: "cursor_move",
      client_id: clientId,
      x: payload.x,
      y: payload.y,
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
      liveTimer = window.setTimeout(flushLive, 80);
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
