/**
 * Фактический E2E: две независимые сессии в одну прямую комнату Jitsi.
 *
 *   node deploy/jitsi/e2e-direct-two-users.mjs
 *
 * JWT не используется. Открывает реальный URL комнаты (не data:).
 */
import { chromium } from "playwright";

const DOMAIN = process.env.JITSI_DOMAIN || "lesson.itflux-academy.ru";
const ROOM = (process.env.JITSI_ROOM || "finaldirecttest20260720").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
const TIMEOUT_MS = Number(process.env.JITSI_E2E_TIMEOUT_MS || 60000);
const USE_CHANNEL = process.env.JITSI_E2E_CHANNEL || "chrome"; // chrome | chromium

const HASH = [
  "config.prejoinPageEnabled=false",
  "config.prejoinConfig.enabled=false",
  "config.requireDisplayName=false",
  "config.disableDeepLinking=true",
  "config.enableWelcomePage=false",
  "config.disableLobbyMode=true",
  "config.lobby.enabled=false",
  "config.startWithAudioMuted=true",
  "config.startWithVideoMuted=false",
  "userInfo.displayName=%22User%22",
].join("&");

function roomUrl(name) {
  return `https://${DOMAIN}/${ROOM}#${HASH.replace("User", name)}`;
}

async function attachNetwork(page, bucket) {
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("xmpp-websocket") || u.includes("http-bind") || u.includes("colibri")) {
      bucket.push({ t: "req", u: u.slice(0, 160), m: req.method() });
    }
  });
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("xmpp-websocket") || u.includes("http-bind") || u.includes("colibri")) {
      bucket.push({ t: "res", u: u.slice(0, 160), s: res.status() });
    }
  });
  page.on("websocket", (ws) => {
    const u = ws.url();
    bucket.push({ t: "ws_open", u: u.slice(0, 160) });
    ws.on("close", () => bucket.push({ t: "ws_close", u: u.slice(0, 160) }));
    ws.on("socketerror", (e) => bucket.push({ t: "ws_err", e: String(e) }));
  });
}

async function readUiState(page) {
  return page.evaluate(() => {
    const text = (document.body && document.body.innerText) || "";
    const hasPrejoin =
      /Присоединиться|Join meeting|Join now|Enter display name/i.test(text);
    const hasLobby = /ожида|lobby|waiting for the moderator/i.test(text);
    const hasAuth = /авториз|authentication|login|войти в аккаунт/i.test(text);
    const hasError = /не удалось|failed|error|connection/i.test(text);
    const videos = document.querySelectorAll("video").length;
    // счётчик участников в UI встречается в разных местах
    let countHint = null;
    const m = text.match(/(\d+)\s*(участник|participants?)/i);
    if (m) countHint = Number(m[1]);
    return {
      title: document.title,
      url: location.href,
      hasPrejoin,
      hasLobby,
      hasAuth,
      hasError,
      videoElements: videos,
      countHint,
      textSample: text.replace(/\s+/g, " ").slice(0, 240),
    };
  });
}

async function waitUntilJoinedOrTimeout(page, label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < TIMEOUT_MS) {
    last = await readUiState(page);
    // эвристика «вошли»: есть video и нет prejoin
    if (!last.hasPrejoin && last.videoElements >= 1) {
      return { joinedLikely: true, ...last };
    }
    // иногда prejoin всё же виден — продолжаем ждать
    await page.waitForTimeout(1000);
  }
  return { joinedLikely: false, ...last, label };
}

async function main() {
  console.log("=== E2E direct two-users (real URL) ===");
  console.log({ domain: DOMAIN, room: ROOM, timeoutMs: TIMEOUT_MS, channel: USE_CHANNEL });

  const launchOpts = {
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-web-security",
    ],
  };
  if (USE_CHANNEL === "chrome") {
    launchOpts.channel = "chrome";
  }

  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (err) {
    console.warn("channel chrome failed, fallback chromium:", err.message);
    delete launchOpts.channel;
    browser = await chromium.launch(launchOpts);
  }

  const mkCtx = async () =>
    browser.newContext({
      permissions: ["camera", "microphone"],
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
    });

  const ctxA = await mkCtx();
  const ctxB = await mkCtx();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const netA = [];
  const netB = [];
  const consA = [];
  const consB = [];
  await attachNetwork(pageA, netA);
  await attachNetwork(pageB, netB);
  pageA.on("console", (m) => consA.push(`[${m.type()}] ${m.text().slice(0, 240)}`));
  pageB.on("console", (m) => consB.push(`[${m.type()}] ${m.text().slice(0, 240)}`));

  const urlA = roomUrl("UserA");
  const urlB = roomUrl("UserB");
  console.log("URL A", urlA);
  console.log("URL B", urlB);

  await pageA.goto(urlA, { waitUntil: "domcontentloaded", timeout: 60000 });
  // клик по странице — иногда нужен gesture
  try { await pageA.mouse.click(640, 400); } catch (_) {}
  // если есть кнопка Join — нажать
  for (const name of ["Присоединиться к встрече", "Присоединиться", "Join meeting", "Join now"]) {
    const btn = pageA.getByRole("button", { name });
    if (await btn.count()) {
      console.log("A clicking", name);
      await btn.first().click({ timeout: 3000 }).catch(() => {});
      break;
    }
  }
  const stateA = await waitUntilJoinedOrTimeout(pageA, "A");
  console.log("\n--- User A ---");
  console.log(JSON.stringify(stateA, null, 2));

  await pageB.goto(urlB, { waitUntil: "domcontentloaded", timeout: 60000 });
  try { await pageB.mouse.click(640, 400); } catch (_) {}
  for (const name of ["Присоединиться к встрече", "Присоединиться", "Join meeting", "Join now"]) {
    const btn = pageB.getByRole("button", { name });
    if (await btn.count()) {
      console.log("B clicking", name);
      await btn.first().click({ timeout: 3000 }).catch(() => {});
      break;
    }
  }
  const stateB = await waitUntilJoinedOrTimeout(pageB, "B");
  console.log("\n--- User B ---");
  console.log(JSON.stringify(stateB, null, 2));

  await pageA.waitForTimeout(10000);
  const stateA2 = await readUiState(pageA);
  const stateB2 = await readUiState(pageB);

  // скриншоты фактов
  await pageA.screenshot({ path: "deploy/jitsi/e2e-userA.png", fullPage: true }).catch(() => {});
  await pageB.screenshot({ path: "deploy/jitsi/e2e-userB.png", fullPage: true }).catch(() => {});

  const report = {
    domain: DOMAIN,
    room: ROOM,
    userA: stateA2,
    userB: stateB2,
    joinedLikelyA: Boolean(stateA.joinedLikely),
    joinedLikelyB: Boolean(stateB.joinedLikely),
    networkA: netA.slice(0, 50),
    networkB: netB.slice(0, 50),
    consoleA: consA.filter((l) => /error|fail|websocket|conference|not-authorized|ICE/i.test(l)).slice(0, 40),
    consoleB: consB.filter((l) => /error|fail|websocket|conference|not-authorized|ICE/i.test(l)).slice(0, 40),
    screenshots: ["deploy/jitsi/e2e-userA.png", "deploy/jitsi/e2e-userB.png"],
  };

  console.log("\n=== FINAL REPORT JSON ===");
  console.log(JSON.stringify(report, null, 2));

  const pass =
    report.joinedLikelyA
    && report.joinedLikelyB
    && !report.userA.hasPrejoin
    && !report.userB.hasPrejoin;

  console.log("\n=== VERDICT ===");
  console.log({
    bothJoinedLikely: report.joinedLikelyA && report.joinedLikelyB,
    prejoinGone: !report.userA.hasPrejoin && !report.userB.hasPrejoin,
    videosA: report.userA.videoElements,
    videosB: report.userB.videoElements,
    wsEventsA: report.networkA.filter((e) => String(e.t).startsWith("ws") || String(e.u || "").includes("websocket")).length,
    wsEventsB: report.networkB.filter((e) => String(e.t).startsWith("ws") || String(e.u || "").includes("websocket")).length,
    boshEventsA: report.networkA.filter((e) => String(e.u || "").includes("http-bind")).length,
    boshEventsB: report.networkB.filter((e) => String(e.u || "").includes("http-bind")).length,
    pass,
  });

  await browser.close();
  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
