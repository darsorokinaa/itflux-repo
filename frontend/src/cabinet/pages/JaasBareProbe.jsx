/** Temporary local diagnostic. Not a product screen. */
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { fetchVideoMeetingJoinConfig } from "../../utils/cabinetAuth";
import {
  buildJitsiConfigOverwrite,
  buildJitsiInterfaceConfigOverwrite,
  loadJitsiExternalApi,
  resolveJitsiApiRoomName,
} from "../jitsiMeet";

function jwtClaims(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const user = json?.context?.user || {};
    return {
      aud: json.aud,
      iss: json.iss,
      sub: json.sub,
      room: json.room,
      exp: json.exp,
      moderator: user.moderator,
      userId: user.id,
    };
  } catch {
    return { error: "payload undecodable" };
  }
}

function line(event, detail) {
  const stamp = new Date().toISOString().slice(11, 23);
  return `${stamp} ${event}${detail ? ` ${JSON.stringify(detail)}` : ""}`;
}

function optionsForGroup(group) {
  const prejoinOff = {
    prejoinConfig: { enabled: false },
    prejoinPageEnabled: false,
  };
  if (group === "prejoin") return { configOverwrite: prejoinOff };
  if (group === "toolbar") {
    return { configOverwrite: { ...prejoinOff, toolbarButtons: ["microphone", "camera", "desktop", "hangup"] } };
  }
  if (group === "filmstrip") {
    return { configOverwrite: { ...prejoinOff, filmstrip: { disableStageFilmstrip: true } } };
  }
  if (group === "interface") {
    return { configOverwrite: prejoinOff, interfaceConfigOverwrite: buildJitsiInterfaceConfigOverwrite() };
  }
  if (group === "full") {
    return {
      configOverwrite: buildJitsiConfigOverwrite({ domain: "8x8.vc", startWithVideoMuted: false, startWithAudioMuted: true }),
      interfaceConfigOverwrite: buildJitsiInterfaceConfigOverwrite(),
    };
  }
  return {};
}

export default function JaasBareProbe() {
  const { meetingUuid } = useParams();
  const [search] = useSearchParams();
  const group = search.get("group") || "bare";
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const [log, setLog] = useState([]);

  useEffect(() => {
    const push = (event, detail) => {
      const row = line(event, detail);
      console.debug("[jaas-bare]", row);
      setLog((prev) => [...prev, row]);
    };
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      const extra = optionsForGroup(group);
      push("probe start", {
        meetingUuid,
        group,
        configKeys: extra.configOverwrite ? Object.keys(extra.configOverwrite) : [],
        interfaceKeys: extra.interfaceConfigOverwrite ? Object.keys(extra.interfaceConfigOverwrite) : [],
      });
      let devices = [];
      try {
        devices = await navigator.mediaDevices?.enumerateDevices?.() || [];
      } catch (err) {
        push("enumerateDevices error", { name: err?.name || "error" });
      }
      const videos = devices.filter((d) => d.kind === "videoinput");
      push("enumerateDevices", {
        videoinput: videos.length,
        labels: videos.map((d) => Boolean(d.label)),
        audioinput: devices.filter((d) => d.kind === "audioinput").length,
      });

      const config = await fetchVideoMeetingJoinConfig(meetingUuid, {});
      if (cancelled) return;
      const domain = String(config.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
      const roomName = resolveJitsiApiRoomName(config);
      push("join-config", {
        provider: config.provider,
        domain,
        hasJwt: Boolean(config.jwt),
        authMode: config.authMode,
        localRoom: config.roomName,
        apiRoom: roomName,
        appId: config.appId || "",
        claims: jwtClaims(config.jwt),
      });

      const Api = await loadJitsiExternalApi(domain, { scriptUrl: config.scriptUrl || "" });
      if (cancelled || !hostRef.current) return;
      hostRef.current.innerHTML = "";
      const options = {
        roomName,
        jwt: config.jwt,
        parentNode: hostRef.current,
        ...extra,
      };
      push("API create", {
        domain,
        roomName,
        keys: Object.keys(options).filter((key) => key !== "jwt"),
        hasJwt: Boolean(options.jwt),
      });
      const api = new Api(domain, options);
      apiRef.current = api;
      push("API created");

      const on = (name) => {
        api.addListener?.(name, (event) => {
          const safe = event && typeof event === "object" ? { ...event } : { value: event };
          delete safe.jwt;
          delete safe.token;
          push(name, safe);
        });
      };
      [
        "videoConferenceJoined",
        "participantJoined",
        "participantLeft",
        "videoMuteStatusChanged",
        "audioMuteStatusChanged",
        "cameraError",
        "micError",
        "browserSupport",
        "errorOccurred",
        "mediaError",
      ].forEach(on);

      api.addListener?.("videoConferenceJoined", async () => {
        const iframe = api.getIFrame?.();
        const rect = iframe?.getBoundingClientRect?.();
        let videoMuted = null;
        let audioMuted = null;
        let available = null;
        let participants = null;
        try { videoMuted = await api.isVideoMuted?.(); } catch (err) { videoMuted = err?.name || "unavailable"; }
        try { audioMuted = await api.isAudioMuted?.(); } catch (err) { audioMuted = err?.name || "unavailable"; }
        try { available = await api.getAvailableDevices?.(); } catch (err) { available = err?.name || "unavailable"; }
        try { participants = api.getParticipantsInfo?.(); } catch (err) { participants = err?.name || "unavailable"; }
        const videoinputs = Array.isArray(available?.videoInput) ? available.videoInput.length : available;
        push("joined media", {
          videoMuted,
          audioMuted,
          videoinput: videoinputs,
          participants: Array.isArray(participants)
            ? participants.map((p) => ({
              id: p.participantId || p.id || "",
              displayName: p.displayName || p.formattedDisplayName || "",
            }))
            : participants,
          participantCount: Array.isArray(participants) ? participants.length : null,
          iframe: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
        });
      });
    })().catch((err) => {
      if (!ac.signal.aborted) push("probe error", { name: err?.name, message: err?.message, status: err?.status });
    });

    return () => {
      cancelled = true;
      ac.abort();
      const api = apiRef.current;
      apiRef.current = null;
      try { api?.dispose?.(); } catch { /* ignore */ }
    };
  }, [group, meetingUuid]);

  return (
    <div style={{ margin: 16, fontFamily: "sans-serif", color: "#111" }}>
      <p style={{ margin: "0 0 8px" }}>JaaS bare probe. No lesson chrome, no configOverwrite.</p>
      <div
        ref={hostRef}
        id="jaas-bare-root"
        style={{ width: 900, height: 650, background: "#444", position: "relative" }}
      />
      <pre id="jaas-bare-log" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{log.join("\n")}</pre>
    </div>
  );
}
