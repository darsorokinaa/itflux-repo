import { describe, expect, it } from "vitest";

/**
 * Same ownership rule as Generator/Generator/templates/lesson_room.html:
 * a late close of socket A must not schedule a reconnect after socket B exists.
 */
function createLessonSockets(WebSocketImpl) {
  let ws = null;
  let reconnects = 0;

  function open() {
    const socket = new WebSocketImpl();
    ws = socket;
    socket.onclose = () => {
      if (ws !== socket) return;
      reconnects += 1;
    };
    return socket;
  }

  return {
    open,
    close(socket) {
      socket.onclose();
    },
    reconnects: () => reconnects,
  };
}

describe("legacy lesson socket identity", () => {
  it("ignores a stale close after reconnect", () => {
    class Socket {
      constructor() {
        this.onclose = null;
      }
    }
    const owner = createLessonSockets(Socket);
    const first = owner.open();
    const second = owner.open();
    owner.close(first);
    expect(owner.reconnects()).toBe(0);
    owner.close(second);
    expect(owner.reconnects()).toBe(1);
  });
});