import { describe, expect, it } from "vitest";

import {
  CALL_STATES,
  canTransitionCallState,
  createCallStateMachine,
  jwtNeedsAttention,
  jwtRemainingSeconds,
} from "./jitsiCallState";

describe("call state machine", () => {
  it("allows idle → initializing → connecting → joined", () => {
    const machine = createCallStateMachine();
    expect(machine.transition(CALL_STATES.initializing).state).toBe("initializing");
    expect(machine.transition(CALL_STATES.connecting).state).toBe("connecting");
    expect(machine.transition(CALL_STATES.joined).state).toBe("joined");
  });

  it("rejects illegal transitions without corrupting state", () => {
    const machine = createCallStateMachine();
    machine.transition(CALL_STATES.initializing);
    const snap = machine.transition(CALL_STATES.joined, "too-soon");
    expect(snap.state).toBe("initializing");
    expect(canTransitionCallState("idle", "joined")).toBe(false);
  });

  it("counts reconnects and resets on new init", () => {
    const machine = createCallStateMachine();
    machine.transition(CALL_STATES.initializing);
    machine.transition(CALL_STATES.connecting);
    machine.transition(CALL_STATES.joined);
    machine.transition(CALL_STATES.reconnecting, "network");
    machine.transition(CALL_STATES.joined, "recovered");
    machine.transition(CALL_STATES.reconnecting, "network-2");
    expect(machine.snapshot().reconnectCount).toBe(2);
    machine.transition(CALL_STATES.failed, "give-up");
    machine.transition(CALL_STATES.initializing, "retry");
    expect(machine.snapshot().reconnectCount).toBe(0);
  });
});

describe("jwt remaining", () => {
  it("detects near-expiry tokens", () => {
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(jwtRemainingSeconds(soon)).toBeGreaterThan(0);
    expect(jwtRemainingSeconds(soon)).toBeLessThan(120);
    expect(jwtNeedsAttention(soon)).toBe(true);
    expect(jwtNeedsAttention(later)).toBe(false);
    expect(jwtRemainingSeconds("not-a-date")).toBeNull();
  });
});
