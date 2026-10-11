import { describe, expect, it, vi } from "vitest";

import {
  classifyConferenceFault,
  conferenceStatusView,
  describeConferenceClient,
  logConferenceStage,
} from "./conferenceDiagnostics";

describe("classifyConferenceFault", () => {
  it("separates backend, script, auth, permission, network and device", () => {
    expect(classifyConferenceFault({ code: "config" })).toBe("backend");
    expect(classifyConferenceFault({ status: 500 })).toBe("backend");
    expect(classifyConferenceFault({ code: "jitsi_script_timeout" })).toBe("script");
    expect(classifyConferenceFault({ code: "jitsi_auth" })).toBe("auth");
    expect(classifyConferenceFault({ code: "permission_denied" })).toBe("permission");
    expect(classifyConferenceFault({ code: "device_missing" })).toBe("device");
    expect(classifyConferenceFault({ code: "jitsi_connection_failed" })).toBe("network");
    expect(classifyConferenceFault({ online: false, code: "jitsi_auth" })).toBe("network");
    expect(classifyConferenceFault({ code: "something-else" })).toBe("unknown");
  });
});

describe("conferenceStatusView", () => {
  it("uses a reconnecting label without treating a permission warning as a network loss", () => {
    expect(conferenceStatusView({
      connectionHint: "Соединение восстанавливается…",
      joinState: "joined",
    })).toEqual({ phase: "reconnecting", title: "Восстанавливаем соединение" });
    expect(conferenceStatusView({
      mediaWarning: "Нет разрешения на микрофон",
      connectionHint: "Соединение восстанавливается…",
    }).phase).toBe("permission");
    expect(conferenceStatusView({
      connectionHint: "Подключаем видеозвонок…",
      joinState: "",
    }).phase).toBe("connecting");
    expect(conferenceStatusView({
      connectionHint: "Подключаем видеозвонок…",
      joinState: "joined",
    }).phase).toBe("");
  });
});

describe("logConferenceStage", () => {
  it("drops secrets and keeps the diagnostic id", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const entry = logConferenceStage("connect_start", {
      diagId: "call-1",
      jwt: "secret-token",
      token: "secret",
      password: "secret",
      browser: "safari",
    });
    expect(entry.diagId).toBe("call-1");
    expect(entry.jwt).toBeUndefined();
    expect(entry.token).toBeUndefined();
    expect(entry.password).toBeUndefined();
    expect(entry.browser).toBe("safari");
    spy.mockRestore();
  });
});

describe("describeConferenceClient", () => {
  it("returns a short browser label", () => {
    const client = describeConferenceClient();
    expect(client.browser).toEqual(expect.any(String));
    expect(client.form).toEqual(expect.any(String));
  });
});
