/** WebSocket-синхронизация совместного редактирования доски. */

import { mergeCollabScenes, type CollabScene } from "./boardSceneMerge";

export type { CollabScene } from "./boardSceneMerge";

export type CollabPeer = {
  clientId: string;
  userId?: number | null;
  displayName: string;
  canEdit?: boolean;
};

export type CollabMessage =
  | { type: "ready"; board_id: string; can_edit: boolean; permission: string }
  | { type: "presence_join"; client_id: string; user_id?: number; display_name?: string; can_edit?: boolean }
  | { type: "presence_leave"; client_id: string; user_id?: number; display_name?: string }
  | { type: "scene_live"; client_id: string; user_id?: number; display_name?: string; version?: number; scene: CollabScene }
  | { type: "scene_saved"; board_id?: string; version: number; scene: CollabScene; user_id?: number; display_name?: string; client_id?: string }
  | { type: "cursor"; client_id: string; x?: number; y?: number; display_name?: string };

type Handlers = {
  onReady?: () => void;
  onPeersChange?: (peers: CollabPeer[]) => void;
  onRemoteScene?: (scene: CollabScene, meta: { version?: number; fromSaved?: boolean; clientId?: string }) => void;
  onStatus?: (status: "connecting" | "open" | "closed" | "error") => void;
};

function wsUrl(boardId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/interactive-boards/${boardId}/`;
}

export { mergeCollabScenes };

export function createBoardCollabSession(
  boardId: string,
  displayName: string,
  handlers: Handlers = {},
) {
  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingLive: CollabScene | null = null;
  let pendingVersion: number | undefined;
  let lastPresenceReplyAt = 0;
  const peers = new Map<string, CollabPeer>();

  const emitPeers = () => {
    handlers.onPeersChange?.(Array.from(peers.values()));
  };

  const sendJoin = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "join",
        client_id: clientId,
        display_name: displayName,
      }),
    );
  };

  const connect = () => {
    if (closed) return;
    handlers.onStatus?.("connecting");
    socket = new WebSocket(wsUrl(boardId));

    socket.onopen = () => {
      handlers.onStatus?.("open");
      sendJoin();
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

      if (data.type === "presence_join") {
        if (data.client_id === clientId) return;
        const isNew = !peers.has(data.client_id);
        peers.set(data.client_id, {
          clientId: data.client_id,
          userId: data.user_id,
          displayName: data.display_name || "Участник",
          canEdit: data.can_edit,
        });
        emitPeers();
        // Уже сидящие отвечают join'ом (с кулдауном), чтобы новичок увидел presence.
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
      socket = null;
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 1500);
    };
  };

  connect();

  const flushLive = () => {
    liveTimer = null;
    if (!pendingLive || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "scene_live",
        client_id: clientId,
        version: pendingVersion,
        scene: pendingLive,
      }),
    );
    pendingLive = null;
  };

  return {
    clientId,
    publishLive(scene: CollabScene, version?: number) {
      pendingLive = scene;
      pendingVersion = version;
      if (liveTimer != null) return;
      // Чаще, чем раньше (160ms) — меньше «отставания» при совместном рисовании.
      liveTimer = window.setTimeout(flushLive, 80);
    },
    close() {
      closed = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      if (liveTimer != null) window.clearTimeout(liveTimer);
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
