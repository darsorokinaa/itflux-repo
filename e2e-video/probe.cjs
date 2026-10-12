/**
 * Два независимых браузера на локальном стенде.
 * В отчёт не попадают пароли, JWT и адреса с токеном.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../e2e-real-devices/node_modules/playwright");

const RUN = path.join(__dirname, ".run");
const SHOTS = path.join(RUN, "screenshots");
const state = JSON.parse(fs.readFileSync(path.join(RUN, "state.json"), "utf8"));
const creds = JSON.parse(fs.readFileSync(path.join(RUN, "credentials.json"), "utf8"));
const base = state.baseUrl;
const meetingUrl = `${base}/cabinet/meetings/${state.meetingUuid}`;
const results = {
  startedAt: new Date().toISOString(),
  database: state.database,
  A: {},
  B: {},
  C: {},
  D: {},
  E: {},
  F: {},
  UX: [],
  notes: [],
};

function redact(value) {
  return String(value || "")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .slice(0, 240);
}

function save() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(RUN, "results.json"), JSON.stringify(results, null, 2));
}

async function api(page, urlPath, options = {}) {
  return page.evaluate(async ({ urlPath, options }) => {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = "application/json";
    if (match) headers["X-CSRFToken"] = decodeURIComponent(match[1]);
    const response = await fetch(urlPath, {
      credentials: "same-origin",
      cache: "no-store",
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => null);
    let claims = null;
    const token = data && (data.token || data.livekitToken || data.jaasToken);
    if (typeof token === "string" && token.includes(".")) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        const video = payload.video || payload.context?.user || {};
        claims = {
          canPublishData: video.canPublishData === true,
          roomAdmin: video.roomAdmin === true,
          roomSet: Boolean(video.room || payload.room),
        };
      } catch {
        claims = { decode: false };
      }
    }
    const safe = data && typeof data === "object" ? {
      provider: data.provider || data.mediaProvider || null,
      generation: data.generation ?? data.mediaGeneration ?? null,
      enabled: data.enabled,
      switched: data.switched,
      fallbackReady: data.fallbackReady,
      code: data.code || null,
      authenticated: data.authenticated,
      role: data.role || data.profile?.role || null,
      canManage: data.canManage,
    } : null;
    return { status: response.status, data: safe, claims };
  }, { urlPath, options });
}

async function routeOf(page) {
  return api(page, `/api/video-meetings/${state.meetingUuid}/media-route/`);
}

async function waitRoute(page, predicate, timeout = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await routeOf(page);
    if (predicate(last)) return { ...last, waitedMs: Date.now() - started };
    await page.waitForTimeout(400);
  }
  return { ...(last || {}), waitedMs: Date.now() - started, timedOut: true };
}

function attachLogs(page, bucket) {
  page.on("console", (msg) => {
    const text = redact(msg.text());
    if (/jwt|token|bearer|password|secret/i.test(text) && !text.includes("[jwt]") && !text.includes("[redacted]")) return;
    bucket.push({ type: msg.type(), text });
    if (bucket.length > 40) bucket.shift();
  });
  page.on("pageerror", (error) => {
    bucket.push({ type: "pageerror", text: redact(error.message) });
  });
}

async function login(page, username) {
  await page.goto(`${base}/cabinet/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email или логин").fill(username);
  await page.getByLabel("Пароль").fill(creds.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 });
  return api(page, "/api/cabinet/me/");
}

async function openMeeting(page) {
  await page.goto(meetingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
}

async function frameHosts(page) {
  return page.frames().map((frame) => {
    try {
      return new URL(frame.url()).host;
    } catch {
      return "";
    }
  }).filter(Boolean);
}

async function jitsiProof(page) {
  const frames = page.frames().filter((frame) => {
    try {
      return new URL(frame.url()).host.includes("8x8.vc");
    } catch {
      return false;
    }
  });
  const proofs = [];
  for (const frame of frames) {
    try {
      proofs.push(await frame.evaluate(() => {
        const videos = [...document.querySelectorAll("video")].map((video) => ({
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState,
          paused: video.paused,
        }));
        const audios = [...document.querySelectorAll("audio")].length;
        return { videos, audios };
      }));
    } catch (error) {
      proofs.push({ error: redact(error.message) });
    }
  }
  return { frames: frames.length, proofs };
}

async function liveKitProof(page) {
  return page.evaluate(async () => {
    const videos = [...document.querySelectorAll("video")].map((video) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
      paused: video.paused,
    }));
    const audioEls = [...document.querySelectorAll("audio")];
    const energies = [];
    const context = audioEls.length ? new AudioContext() : null;
    for (const audio of audioEls) {
      const stream = audio.srcObject;
      const tracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
      let energy = null;
      if (context && tracks.length) {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
        energy = bins.reduce((sum, value) => sum + value, 0) / bins.length;
      }
      energies.push({
        tracks: tracks.length,
        enabled: tracks[0] ? tracks[0].enabled : null,
        muted: tracks[0] ? tracks[0].muted : null,
        energy,
      });
    }
    if (context) await context.close();
    return { videos, remoteAudios: energies };
  });
}

async function rtcStats(page) {
  const rows = [];
  for (const frame of page.frames()) {
    let host = "";
    try {
      host = new URL(frame.url()).host;
    } catch {
      host = "";
    }
    try {
      const stats = await frame.evaluate(async () => {
        const connections = window.__pcs || [];
        const result = [];
        for (const pc of connections) {
          const report = await pc.getStats();
          let bytesSent = 0;
          let bytesReceived = 0;
          let framesDecoded = 0;
          report.forEach((item) => {
            if (item.type === "outbound-rtp") bytesSent += item.bytesSent || 0;
            if (item.type === "inbound-rtp") {
              bytesReceived += item.bytesReceived || 0;
              framesDecoded += item.framesDecoded || 0;
            }
          });
          result.push({
            state: pc.connectionState,
            ice: pc.iceConnectionState,
            senders: pc.getSenders().filter((sender) => sender.track).length,
            receivers: pc.getReceivers().filter((receiver) => receiver.track).length,
            bytesSent,
            bytesReceived,
            framesDecoded,
          });
        }
        return result;
      });
      if (stats.length) rows.push({ host, stats });
    } catch {
      /* frame without the hook */
    }
  }
  return rows;
}

async function localTracks(page) {
  return rtcStats(page);
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function switchKind(page, name) {
  const started = Date.now();
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/media-route/switch") && response.request().method() === "POST",
    { timeout: 20000 },
  ).catch(() => null);
  await page.getByRole("button", { name, exact: true }).click();
  const response = await responsePromise;
  let body = null;
  if (response) {
    const json = await response.json().catch(() => null);
    body = json && {
      status: response.status(),
      provider: json.provider,
      generation: json.generation,
      switched: json.switched,
      code: json.code || null,
    };
  }
  return { clickMs: Date.now() - started, response: body };
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--ignore-certificate-errors",
    ],
  });
  const contextOptions = {
    ignoreHTTPSErrors: true,
    locale: "ru-RU",
    viewport: { width: 1440, height: 900 },
    permissions: ["camera", "microphone"],
  };
  const teacherContext = await browser.newContext(contextOptions);
  const studentContext = await browser.newContext(contextOptions);
  await teacherContext.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    function Wrapped(...args) {
      const pc = new Original(...args);
      window.__pcs.push(pc);
      return pc;
    }
    Wrapped.prototype = Original.prototype;
    Object.setPrototypeOf(Wrapped, Original);
    window.RTCPeerConnection = Wrapped;
  });
  await studentContext.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    function Wrapped(...args) {
      const pc = new Original(...args);
      window.__pcs.push(pc);
      return pc;
    }
    Wrapped.prototype = Original.prototype;
    Object.setPrototypeOf(Wrapped, Original);
    window.RTCPeerConnection = Wrapped;
  });
  const teacher = await teacherContext.newPage();
  const student = await studentContext.newPage();
  const teacherLogs = [];
  const studentLogs = [];
  attachLogs(teacher, teacherLogs);
  attachLogs(student, studentLogs);

  try {
    const teacherMe = await login(teacher, state.teacher);
    const studentMe = await login(student, state.student);
    results.login = {
      teacherStatus: teacherMe.status,
      studentStatus: studentMe.status,
      teacherAuthenticated: teacherMe.data && teacherMe.data.authenticated === true,
      studentAuthenticated: studentMe.data && studentMe.data.authenticated === true,
      separateContexts: true,
    };
    if (!results.login.teacherAuthenticated || !results.login.studentAuthenticated) {
      results.notes.push("login failed; frontend may be pointed at the wrong backend");
      save();
      return;
    }

    await openMeeting(teacher);
    await openMeeting(student);
    async function passLobby(page) {
      const cookie = page.getByRole("button", { name: "Принять" });
      if (await cookie.count()) await cookie.click().catch(() => {});
      const withCamera = page.getByRole("button", { name: "С камерой" });
      const visible = await withCamera.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
      if (visible) await withCamera.click();
      return visible;
    }
    const [teacherLobby, studentLobby] = await Promise.all([passLobby(teacher), passLobby(student)]);
    results.A.lobby = { teacher: teacherLobby, student: studentLobby };
    async function waitHost(page, hostPart, timeout = 40000) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const hosts = await frameHosts(page);
        if (hosts.some((host) => host.includes(hostPart))) return true;
        await page.waitForTimeout(1000);
      }
      return false;
    }
    results.A.teacherFrame = await waitHost(teacher, "8x8.vc");
    results.A.studentFrame = await waitHost(student, "8x8.vc");
    await teacher.waitForTimeout(8000);
    results.A.teacherUrl = teacher.url();
    results.A.studentUrl = student.url();
    const pageText = async (page) => (await page.locator("body").innerText().catch(() => ""))
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
      .slice(0, 1500);
    results.A.teacherText = await pageText(teacher);
    results.A.studentText = await pageText(student);
    await shot(teacher, "A-teacher-open");
    await shot(student, "A-student-open");
    const switcher = teacher.getByRole("button", { name: "Основная связь" });
    const appeared = await switcher.waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
    results.A.switcherVisible = appeared;
    if (!appeared) {
      results.notes.push("call switch was not visible");
      results.logs = { teacher: teacherLogs.slice(-15), student: studentLogs.slice(-15) };
      save();
      return;
    }
    const studentSwitcher = await student.getByRole("group", { name: "Вид связи" }).count();
    results.A.studentSeesSwitcher = studentSwitcher > 0;
    await teacher.waitForTimeout(12000);
    await student.waitForTimeout(2000);
    results.A.teacherHosts = await frameHosts(teacher);
    results.A.studentHosts = await frameHosts(student);
    results.A.teacherJitsi = await jitsiProof(teacher);
    results.A.studentJitsi = await jitsiProof(student);
    results.A.teacherRtc = await rtcStats(teacher);
    results.A.studentRtc = await rtcStats(student);
    results.A.joinedSdk = (results.A.teacherJitsi.frames > 0) && (results.A.studentJitsi.frames > 0);
    const teacherVideo = (results.A.teacherJitsi.proofs || []).flatMap((item) => item.videos || []);
    const studentVideo = (results.A.studentJitsi.proofs || []).flatMap((item) => item.videos || []);
    results.A.decodedVideo = teacherVideo.some((item) => item.width > 0) && studentVideo.some((item) => item.width > 0);
    results.A.playback = "not confirmed: remote audio inside the 8x8 frame was not measured as played sound";
    await shot(teacher, "A-teacher-8x8");
    await shot(student, "A-student-8x8");

    for (const width of [375, 390, 768, 1366, 1440]) {
      await teacher.setViewportSize({ width, height: 900 });
      await student.setViewportSize({ width, height: 900 });
      await teacher.waitForTimeout(300);
      const teacherOverflow = await teacher.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        switcher: Boolean(document.querySelector('[aria-label="Вид связи"]')),
      }));
      const studentOverflow = await student.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        switcher: Boolean(document.querySelector('[aria-label="Вид связи"]')),
      }));
      await shot(teacher, `ux-teacher-${width}`);
      await shot(student, `ux-student-${width}`);
      results.UX.push({ width, teacher: teacherOverflow, student: studentOverflow });
    }
    await teacher.setViewportSize({ width: 1440, height: 900 });
    await student.setViewportSize({ width: 1440, height: 900 });

    const before = await routeOf(teacher);
    const toLiveKit = await switchKind(teacher, "Резервная связь");
    const studentSaw = await waitRoute(student, (item) => item.data && item.data.provider === "livekit");
    await teacher.getByRole("button", { name: "Чат" }).waitFor({ timeout: 30000 }).catch(() => null);
    await student.waitForTimeout(8000);
    results.B.switch = toLiveKit;
    results.B.serverMs = toLiveKit.clickMs;
    results.B.studentDetectMs = studentSaw.waitedMs;
    results.B.studentRoute = studentSaw.data;
    results.B.beforeGeneration = before.data && before.data.generation;
    results.B.teacherLiveKit = await liveKitProof(teacher);
    results.B.studentLiveKit = await liveKitProof(student);
    results.B.teacherRtc = await rtcStats(teacher);
    results.B.studentRtc = await rtcStats(student);
    results.B.seedClaims = state.claims;
    const chatText = `стенд ${Date.now().toString().slice(-6)}`;
    let chat = { sent: false, received: false };
    const chatButton = teacher.getByRole("button", { name: "Чат" });
    if (await chatButton.count()) {
      const teacherClicked = await chatButton.click({ timeout: 8000 }).then(() => true).catch((error) => {
        chat.teacherClick = redact(error.message);
        return false;
      });
      if (teacherClicked) {
        await teacher.getByPlaceholder("Написать сообщение…").fill(chatText);
        await teacher.getByRole("button", { name: "Отправить" }).click();
        chat.sent = true;
        const studentChat = student.getByRole("button", { name: "Чат" });
        const studentClicked = await studentChat.click({ timeout: 8000 }).then(() => true).catch((error) => {
          chat.studentClick = redact(error.message);
          return false;
        });
        if (studentClicked) {
          try {
            await student.getByText(chatText).waitFor({ timeout: 8000 });
            chat.received = true;
          } catch {
            chat.received = false;
          }
        }
      }
    }
    results.B.chatTeacherToStudent = chat;
    const reply = `ответ ${Date.now().toString().slice(-6)}`;
    if (chat.received) {
      await student.getByPlaceholder("Написать сообщение…").fill(reply);
      await student.getByRole("button", { name: "Отправить" }).click();
      try {
        await teacher.getByText(reply).waitFor({ timeout: 8000 });
        results.B.chatStudentToTeacher = { sent: true, received: true };
      } catch {
        results.B.chatStudentToTeacher = { sent: true, received: false };
      }
    }
    const handButton = student.getByRole("button", { name: "Поднять руку" });
    if (await handButton.count()) {
      await handButton.click();
      await teacher.getByRole("button", { name: /Участники/ }).click().catch(() => null);
      const visible = await teacher.getByText("Рука поднята").count();
      results.B.hand = { clicked: true, visibleToTeacher: visible > 0 };
      const lower = student.getByRole("button", { name: "Опустить руку" });
      if (await lower.count()) await lower.click();
    } else {
      results.B.hand = { clicked: false };
    }
    results.B.playback = "analyser energy is recorded; speaker playback was not confirmed";
    await shot(teacher, "B-teacher-livekit");
    await shot(student, "B-student-livekit");

    const backStarted = Date.now();
    const tracksBefore = await localTracks(teacher);
    const toJaas = await switchKind(teacher, "Основная связь");
    const samples = [];
    for (let i = 0; i < 8; i += 1) {
      samples.push({ atMs: Date.now() - backStarted, teacher: await localTracks(teacher) });
      await teacher.waitForTimeout(500);
    }
    const studentBack = await waitRoute(student, (item) => item.data && item.data.provider && item.data.provider !== "livekit");
    await teacher.waitForTimeout(8000);
    results.C = {
      clickToResponseMs: toJaas.clickMs,
      response: toJaas.response,
      studentDetectMs: studentBack.waitedMs,
      studentRoute: studentBack.data,
      bothJoined: (await jitsiProof(teacher)).frames > 0 && (await jitsiProof(student)).frames > 0,
      teacherJitsi: await jitsiProof(teacher),
      studentJitsi: await jitsiProof(student),
    };
    results.E = {
      tracksBefore,
      samples,
      tracksAfter: await localTracks(teacher),
      note: "counts are RTCPeerConnection senders/receivers visible to the page, including the 4 second window",
    };

    const generationBeforeRace = (await routeOf(teacher)).data;
    const clicks = [];
    for (let i = 0; i < 10; i += 1) {
      teacher.getByRole("button", { name: "Резервная связь", exact: true }).click().catch(() => null);
      clicks.push(Date.now());
    }
    await teacher.waitForTimeout(3000);
    const generationAfter = (await routeOf(teacher)).data;
    results.D.tenClicks = {
      before: generationBeforeRace,
      after: generationAfter,
      delta: generationAfter && generationBeforeRace
        ? Number(generationAfter.generation) - Number(generationBeforeRace.generation)
        : null,
      clickCount: clicks.length,
    };
    const studentSwitch = await api(student, `/api/video-meetings/${state.meetingUuid}/media-route/switch/`, {
      method: "POST",
      body: { provider: "primary", expectedGeneration: generationAfter && generationAfter.generation },
    });
    results.D.studentSwitchStatus = studentSwitch.status;
    results.D.studentSwitchCode = studentSwitch.data && studentSwitch.data.code;
    const stale = await api(teacher, `/api/video-meetings/${state.meetingUuid}/media-route/switch/`, {
      method: "POST",
      body: { provider: "livekit", expectedGeneration: 0 },
    });
    results.D.staleGenerationStatus = stale.status;
    results.D.staleGenerationCode = stale.data && stale.data.code;
    await studentContext.setOffline(true);
    const offlineSwitch = await switchKind(teacher, "Основная связь").catch((error) => ({ error: redact(error.message) }));
    await teacher.waitForTimeout(1000);
    await studentContext.setOffline(false);
    const targetGeneration = offlineSwitch.response && offlineSwitch.response.generation;
    const afterOnline = await waitRoute(
      student,
      (item) => item.data && targetGeneration != null && item.data.generation === targetGeneration,
      20000,
    );
    results.D.offline = {
      switch: offlineSwitch,
      afterOnline: afterOnline.data,
      waitedMs: afterOnline.waitedMs,
      timedOut: Boolean(afterOnline.timedOut),
    };
    await student.reload({ waitUntil: "domcontentloaded" });
    const afterReload = await waitRoute(student, (item) => item.data && item.data.provider, 20000);
    results.D.refresh = afterReload.data;

    await teacher.getByRole("button", { name: /Материалы/ }).click();
    const boardVisible = await teacher.getByText("Доска стенда").count();
    results.F.boardListed = boardVisible > 0;
    const show = teacher.getByRole("button", { name: "Показать" });
    if (boardVisible && await show.count()) {
      await show.first().click();
      await teacher.waitForTimeout(4000);
      results.F.teacherSwitcherWhileBoard = await teacher.getByRole("group", { name: "Вид связи" }).count();
      results.F.studentSwitcherWhileBoard = await student.getByRole("group", { name: "Вид связи" }).count();
      results.F.compactBar = await teacher.locator(".mini-call, .video-lesson-mini").count();
      const sockets = teacherLogs.filter((item) => /ws|websocket|tldraw|sync/i.test(item.text)).slice(-8);
      results.F.socketHints = sockets;
    }
    await shot(teacher, "F-board");
    results.logs = {
      teacher: teacherLogs.slice(-15),
      student: studentLogs.slice(-15),
    };
  } catch (error) {
    results.fatal = redact(error.stack || error.message);
  } finally {
    save();
    await browser.close();
  }
}

main().then(() => {
  const fatal = Boolean(results.fatal);
  process.exit(fatal ? 1 : 0);
}).catch((error) => {
  results.fatal = redact(error.stack || error.message);
  save();
  process.exit(1);
});
