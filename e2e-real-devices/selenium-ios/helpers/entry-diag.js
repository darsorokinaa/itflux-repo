const { executeJson } = require("./execute-json");
const { redactSecrets, screenshot, writeJson } = require("./artifacts");
const { isSessionGone } = require("./classify");

const TIMELINE_EVENTS = [
  "T0_NAVIGATION",
  "T1_MEETING_API",
  "T2_PREJOIN_RENDERED",
  "T3_WITHOUT_CAMERA_RENDERED",
  "T4_WITHOUT_CAMERA_CLICKED",
  "T5_NATIVE_PERMISSION",
  "T6_JITSI_INIT",
  "T7_JITSI_IFRAME",
  "T8_VIDEO_CONFERENCE_JOINED",
  "T9_LIVE_UI",
];

function markTimeline(timeline, name, extras = {}) {
  if (!timeline || timeline[name]) return timeline[name];
  const event = {
    name,
    at: new Date().toISOString(),
    elapsedMs: timeline.startedAtMs ? Date.now() - timeline.startedAtMs : null,
    ...extras,
  };
  timeline[name] = event;
  timeline.events.push(event);
  timeline.lastEvent = name;
  return event;
}

function createTimeline() {
  return {
    startedAtMs: Date.now(),
    startedAt: new Date().toISOString(),
    events: [],
    lastEvent: null,
  };
}

function lastTimelineEvent(timeline) {
  if (!timeline || !timeline.events || !timeline.events.length) return null;
  return timeline.events[timeline.events.length - 1];
}

function applySnapshotToTimeline(timeline, snap) {
  if (!snap) return;
  if (snap.meetingApi && (snap.meetingApi.detailOk || snap.meetingApi.statusOk || snap.meetingApi.joinConfigOk)) {
    markTimeline(timeline, "T1_MEETING_API", { api: snap.meetingApi });
  }
  if (snap.inferredPageState === "camera" || snap.cameraPromptDisplayed) {
    markTimeline(timeline, "T2_PREJOIN_RENDERED", { pageState: snap.inferredPageState });
  }
  if (snap.cameraWithoutDisplayed) {
    markTimeline(timeline, "T3_WITHOUT_CAMERA_RENDERED");
  }
  if (snap.jitsiInitHint) {
    markTimeline(timeline, "T6_JITSI_INIT", { hint: snap.connectionHint });
  }
  if (snap.jitsiIframes >= 1) {
    markTimeline(timeline, "T7_JITSI_IFRAME", { count: snap.jitsiIframes });
  }
  if (snap.liveUi) {
    markTimeline(timeline, "T8_VIDEO_CONFERENCE_JOINED");
    markTimeline(timeline, "T9_LIVE_UI");
  }
}

async function captureEntrySnapshot(browser) {
  try {
    return await executeJson(browser, () => {
      function visible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      }
      function textOf(el) {
        return String((el && el.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 400);
      }
      const root = document.querySelector(".video-lesson-page");
      const state = document.querySelector(".video-lesson-state");
      const title = document.querySelector(".video-lesson-state__title");
      const subtitle = document.querySelector(".video-lesson-state__text");
      const spinner = document.querySelector(".video-lesson-state__spinner");
      const camera = document.querySelector(".video-lesson-state--camera");
      const jitsiHost = document.querySelector(".video-lesson-jitsi-host");
      const jitsi = document.getElementById("jitsi-container");
      const jitsiHostVisible = Boolean(jitsiHost && !jitsiHost.hidden && visible(jitsiHost));
      const jitsiIframes = jitsi ? jitsi.querySelectorAll("iframe").length : 0;
      const buttons = Array.from(document.querySelectorAll("button, [role='button'], a.video-lesson-btn"))
        .filter((el) => visible(el))
        .map((el) => String(el.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20);
      const titleText = textOf(title);
      const bodyText = textOf(state) || textOf(document.querySelector(".video-lesson-content"));
      let inferredPageState = "unknown";
      if (/Не удалось войти во встречу/i.test(bodyText) || /Не удалось войти во встречу/i.test(titleText)) inferredPageState = "error";
      else if (camera && visible(camera)) inferredPageState = "camera";
      else if (/Загрузка/i.test(titleText) && spinner) inferredPageState = "loading";
      else if (/ещё не начат|ещё не начался/i.test(titleText + bodyText)) inferredPageState = "waiting";
      else if (/отмен/i.test(titleText)) inferredPageState = "cancelled";
      else if (/заверш/i.test(titleText)) inferredPageState = "finished";
      else if (jitsiHostVisible && jitsiIframes >= 1) inferredPageState = "live";
      else if (jitsiHostVisible) inferredPageState = "live-shell";
      else if (root) inferredPageState = "blank-room";

      const resources = (performance.getEntriesByType && performance.getEntriesByType("resource")) || [];
      const api = resources.filter((entry) => /video-meetings|join-config|\/status\//i.test(String(entry.name || "")));
      const meetingApi = {
        detailOk: api.some((e) => /video-meetings\/[^/?#]+\/?(\?|$)/i.test(e.name) && (!e.responseStatus || e.responseStatus < 400)),
        statusOk: api.some((e) => /\/status\//i.test(e.name)),
        joinConfigOk: api.some((e) => /join-config/i.test(e.name)),
        http400: api.filter((e) => Number(e.responseStatus) >= 400).map((e) => ({
          name: String(e.name || "").split("?")[0],
          status: Number(e.responseStatus) || 0,
        })),
        names: api.slice(-12).map((e) => ({
          name: String(e.name || "").split("?")[0],
          status: Number(e.responseStatus) || 0,
          duration: Math.round(Number(e.duration) || 0),
        })),
      };
      const connectionHint = textOf(document.querySelector(".video-lesson-connection-hint, .video-lesson-jitsi-host"))
        || (/Подключение к конференции/i.test(document.body.innerText) ? "Подключение к конференции…" : "");
      return JSON.stringify({
        url: String(location.href || ""),
        readyState: String(document.readyState || ""),
        roomRoot: {
          exists: Boolean(root),
          displayed: visible(root),
          className: root ? String(root.className || "") : "",
        },
        inferredPageState,
        spinner: Boolean(spinner && visible(spinner)),
        cameraPromptDisplayed: Boolean(camera && visible(camera)),
        cameraWithoutDisplayed: buttons.some((t) => t === "Без камеры"),
        cameraWithDisplayed: buttons.some((t) => t === "С камерой"),
        startLessonDisplayed: buttons.some((t) => /Начать урок/i.test(t)),
        errorState: inferredPageState === "error",
        titleText,
        centralText: bodyText.slice(0, 500),
        visibleButtons: buttons,
        jitsiContainer: {
          exists: Boolean(jitsi),
          displayed: visible(jitsi),
          hidden: Boolean(jitsi && jitsi.hidden),
          hostHidden: Boolean(jitsiHost && jitsiHost.hidden),
          hostVisible: jitsiHostVisible,
          childCount: jitsi ? jitsi.childElementCount : 0,
        },
        jitsiIframes,
        jitsiInitHint: /Подключение к конференции/i.test(connectionHint + document.body.innerText),
        connectionHint: connectionHint.slice(0, 180),
        liveUi: inferredPageState === "live",
        meetingApi,
        requestFailed: ((window.__itfluxEntryDiag && window.__itfluxEntryDiag.requestFailed) || [])
          .concat(api.filter((e) => Number(e.transferSize) === 0 && Number(e.duration) > 0).map((e) => ({
            url: String(e.name || "").split("?")[0],
            status: Number(e.responseStatus) || 0,
            type: "performance-zero-transfer",
          })))
          .slice(-20),
        pageErrors: ((window.__itfluxEntryDiag && window.__itfluxEntryDiag.pageErrors) || []).slice(-20),
        timestamp: new Date().toISOString(),
      });
    }, "entry-snapshot");
  } catch (err) {
    if (isSessionGone(err)) throw err;
    return {
      url: "",
      readyState: "",
      inferredPageState: "snapshot-failed",
      error: String((err && err.message) || err),
      cameraWithoutDisplayed: false,
      liveUi: false,
      meetingApi: {},
      jitsiIframes: 0,
      visibleButtons: [],
    };
  }
}

async function installEntryDiagHooks(browser) {
  try {
    await executeJson(browser, () => {
      if (window.__itfluxEntryDiag) return JSON.stringify({ installed: false, already: true });
      const diag = { pageErrors: [], requestFailed: [] };
      window.__itfluxEntryDiag = diag;
      window.addEventListener("error", (event) => {
        diag.pageErrors.push({
          type: "pageerror",
          message: String((event && (event.message || (event.error && event.error.message))) || "error").slice(0, 300),
          source: String((event && event.filename) || "").slice(0, 180),
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event && event.reason;
        diag.pageErrors.push({
          type: "unhandledrejection",
          message: String((reason && reason.message) || reason || "rejection").slice(0, 300),
          source: "unhandledrejection",
        });
      });
      const origFetch = window.fetch;
      if (typeof origFetch === "function") {
        window.fetch = function patchedFetch(...args) {
          const raw = args[0];
          const url = String((raw && raw.url) || raw || "").split("?")[0];
          return origFetch.apply(this, args).then((res) => {
            if (res && Number(res.status) >= 400) {
              diag.requestFailed.push({ url: String(res.url || url).split("?")[0], status: Number(res.status), type: "http" });
            }
            return res;
          }, (err) => {
            diag.requestFailed.push({
              url,
              status: 0,
              type: "requestfailed",
              message: String((err && err.message) || err).slice(0, 200),
            });
            throw err;
          });
        };
      }
      return JSON.stringify({ installed: true });
    }, "install-entry-diag");
  } catch (err) {
    if (isSessionGone(err)) throw err;
  }
}

async function captureBrowserLogs(browser) {
  const out = { browser: [], available: false };
  try {
    if (typeof browser.getLogs === "function") {
      const logs = await browser.getLogs("browser");
      out.available = true;
      out.browser = (logs || []).slice(-40).map((row) => ({
        level: String((row && row.level) || ""),
        message: redactSecrets(String((row && row.message) || "")).slice(0, 400),
      }));
    }
  } catch (err) {
    out.error = String((err && err.message) || err);
  }
  return out;
}

async function captureEntryFailure(browser, extras = {}) {
  const snapshot = await captureEntrySnapshot(browser).catch((err) => ({
    inferredPageState: "snapshot-failed",
    error: String((err && err.message) || err),
  }));
  const logs = await captureBrowserLogs(browser).catch(() => ({ available: false }));
  await screenshot(browser, extras.screenshotName || "entry-prejoin-fail").catch(() => {});
  const payload = {
    at: new Date().toISOString(),
    failedStage: extras.failedStage || "PREJOIN",
    lastTimelineEvent: extras.lastTimelineEvent || null,
    navigationToFailureMs: extras.navigationToFailureMs || null,
    staleElementCount: extras.staleElementCount || 0,
    snapshot,
    logs,
    url: redactSecrets(snapshot.url || extras.url || ""),
  };
  writeJson(extras.jsonName || "entry-prejoin-fail.json", payload);
  return payload;
}

function firstDivergence(passTimeline, failTimeline) {
  const passEvents = (passTimeline && passTimeline.events) || [];
  const failEvents = (failTimeline && failTimeline.events) || [];
  const max = Math.max(passEvents.length, failEvents.length);
  for (let i = 0; i < max; i += 1) {
    const pass = passEvents[i] || null;
    const fail = failEvents[i] || null;
    if (!pass || !fail || pass.name !== fail.name) {
      return {
        index: i,
        passEvent: pass ? pass.name : null,
        failEvent: fail ? fail.name : null,
        passLast: passEvents.length ? passEvents[passEvents.length - 1].name : null,
        failLast: failEvents.length ? failEvents[failEvents.length - 1].name : null,
      };
    }
  }
  return {
    index: -1,
    passEvent: null,
    failEvent: null,
    passLast: passEvents.length ? passEvents[passEvents.length - 1].name : null,
    failLast: failEvents.length ? failEvents[failEvents.length - 1].name : null,
    samePrefix: true,
  };
}

function classifyEntryFailure({ snapshot, sessionAlive, staleElementCount }) {
  if (!sessionAlive) {
    return {
      classification: "INFRA_SKIP",
      productFailure: false,
      reason: "BrowserStack session died during entry",
    };
  }
  const state = snapshot && snapshot.inferredPageState;
  const neither = snapshot
    && !snapshot.cameraWithoutDisplayed
    && !snapshot.liveUi
    && snapshot.roomRoot
    && snapshot.roomRoot.exists;
  if (neither) {
    return {
      classification: "INTERMITTENT_PRODUCTION_SUSPECT",
      productFailure: false,
      reason: `room page present but neither prejoin nor live UI (state=${state || "unknown"})`,
      inferredPageState: state,
    };
  }
  if (staleElementCount > 0 && snapshot && (snapshot.cameraWithoutDisplayed || snapshot.liveUi)) {
    return {
      classification: "TEST_BUG",
      productFailure: false,
      reason: "stale element while production UI was actually present",
    };
  }
  return {
    classification: "INTERMITTENT_PRODUCTION_SUSPECT",
    productFailure: false,
    reason: "prejoin wait failed with a live session",
    inferredPageState: state,
  };
}

module.exports = {
  TIMELINE_EVENTS,
  createTimeline,
  markTimeline,
  lastTimelineEvent,
  applySnapshotToTimeline,
  installEntryDiagHooks,
  captureEntrySnapshot,
  captureEntryFailure,
  captureBrowserLogs,
  firstDivergence,
  classifyEntryFailure,
};
