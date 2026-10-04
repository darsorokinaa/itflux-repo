import { describe, expect, it } from "vitest";

import { createRealtimeOutbox, isEphemeralFrame, lessonReconnectPlan } from "./wsSaturation";

function harness() {
  const timers = [];
  const sent = [];
  let clock = 0;
  const outbox = createRealtimeOutbox({
    now: () => clock,
    schedule: (fn, ms) => {
      const timer = { fn, at: clock + ms };
      timers.push(timer);
      return timer;
    },
    clear: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
    send: (payload) => {
      sent.push(JSON.parse(JSON.stringify(payload)));
    },
    maxAttempts: 3,
  });
  const flush = (ms) => {
    clock += ms;
    const due = timers.filter((timer) => timer.at <= clock);
    for (const timer of due) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
      timer.fn();
    }
  };
  return { outbox, sent, flush };
}

describe("lesson and tldraw wake", () => {
  it("returns to the same room after background, offline and sleep", () => {
    const gaps = [
      ["background-30s", { ended: false, visibilityState: "hidden", readyState: 1, attempt: 1 }],
      ["offline-30s", { ended: false, visibilityState: "visible", readyState: 3, attempt: 1 }],
      ["sleep-2min", { ended: false, visibilityState: "hidden", readyState: 3, attempt: 1 }],
      ["sleep-10min", { ended: false, visibilityState: "hidden", readyState: 3, attempt: 1 }],
    ];
    for (const [name, input] of gaps) {
      const plan = lessonReconnectPlan(input);
      expect(plan.sameRoom, name).toBe(true);
      if (name === "background-30s") expect(plan.action).toBe("keep");
      if (name === "offline-30s") expect(plan.action).toBe("reconnect");
      if (name.startsWith("sleep")) expect(plan.action).toBe("wait_visible");
    }
    const woke = lessonReconnectPlan({
      ended: false,
      visibilityState: "visible",
      readyState: 3,
      attempt: 1,
    });
    expect(woke).toMatchObject({ action: "reconnect", sameRoom: true, delayMs: 800 });
  });
});

describe("realtime saturation outbox", () => {
  it("keeps only the latest ephemeral frame", () => {
    const { outbox, sent, flush } = harness();
    outbox.remember({ type: "cursor_move", x: 1 });
    outbox.remember({ type: "cursor_move", x: 2 });
    outbox.remember({ type: "viewport_update", zoom: 3 });
    expect(outbox.pendingIds()).toEqual([]);
    expect(isEphemeralFrame({ type: "material.cursor", action: "cursor" })).toBe(true);
    outbox.onServerMessage({
      type: "temporary_unavailable",
      retry_after_ms: 200,
      failed_type: "viewport_update",
    });
    flush(200);
    expect(sent).toEqual([{ type: "viewport_update", zoom: 3 }]);
  });

  it("retries a durable action once per busy response and acks a single id", () => {
    const { outbox, sent, flush } = harness();
    const answer = { type: "student_answer", answer: "42", task_number: "1" };
    const tracked = outbox.remember(answer);
    sent.push({ ...answer, client_msg_id: tracked.id, attempt: "first" });
    outbox.onServerMessage({
      type: "temporary_unavailable",
      retry_after_ms: 200,
      failed_type: "student_answer",
      client_msg_id: tracked.id,
    });
    expect(sent.filter((row) => row.client_msg_id === tracked.id)).toHaveLength(1);
    flush(200);
    const retries = sent.filter((row) => row.client_msg_id === tracked.id && !row.attempt);
    expect(retries).toHaveLength(1);
    expect(retries[0].answer).toBe("42");
    expect(outbox.onServerMessage({
      type: "student_answer",
      client_msg_id: tracked.id,
      answer: "42",
    }).kind).toBe("ack");
    expect(outbox.onServerMessage({
      type: "student_answer",
      client_msg_id: tracked.id,
      answer: "42",
    }).kind).toBe("ignore");
    expect(outbox.pendingIds()).toEqual([]);
  });

  it("does not lose or duplicate three durable actions under a saturation burst", () => {
    const { outbox, sent, flush } = harness();
    const ids = ["a", "b", "c"].map((suffix, index) => {
      const payload = {
        type: "material.operation",
        operation_id: `op-${suffix}`,
        action: "field_changed",
        payload: { value: index },
      };
      outbox.remember(payload);
      return payload.operation_id;
    });
    for (const id of ids) {
      outbox.onServerMessage({
        type: "temporary_unavailable",
        retry_after_ms: 200,
        failed_type: "material.operation",
        operation_id: id,
        action: "field_changed",
      });
    }
    flush(200);
    const retried = sent.map((row) => row.operation_id);
    expect(retried).toEqual(ids);
    expect(new Set(retried).size).toBe(3);
    for (const id of ids) {
      expect(outbox.onServerMessage({
        type: "material.operation_ack",
        operation_id: id,
      }).kind).toBe("ack");
    }
    expect(outbox.pendingIds()).toEqual([]);
    flush(1000);
    expect(sent).toHaveLength(3);
  });

  it("reports a clear failure after the last durable retry", () => {
    const { outbox, flush } = harness();
    const failed = [];
    const tracked = outbox.remember({ type: "student_answer", answer: "7" });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      outbox.onServerMessage({
        type: "temporary_unavailable",
        retry_after_ms: 200,
        failed_type: "student_answer",
        client_msg_id: tracked.id,
      }, { onFailed: (payload) => failed.push(payload.answer) });
      flush(200);
    }
    expect(failed).toEqual(["7"]);
    expect(outbox.pendingIds()).toEqual([]);
  });
});
