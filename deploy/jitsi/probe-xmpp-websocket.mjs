/**
 * Фактическая проверка /xmpp-websocket и /http-bind.
 *   node deploy/jitsi/probe-xmpp-websocket.mjs
 */
import WebSocket from "ws";

const DOMAIN = process.env.JITSI_DOMAIN || "lesson.itflux-academy.ru";
const WS_URL = `wss://${DOMAIN}/xmpp-websocket`;
const BOSH_URL = `https://${DOMAIN}/http-bind`;

async function probeBosh() {
  const body =
    `<body rid="1" xmlns="http://jabber.org/protocol/httpbind" to="${DOMAIN}" wait="60" hold="1" ver="1.6"/>`;
  const res = await fetch(BOSH_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });
  const text = await res.text();
  const mechanisms = [...text.matchAll(/<mechanism>([^<]+)<\/mechanism>/g)].map((m) => m[1]);
  return {
    httpStatus: res.status,
    contentType: res.headers.get("content-type"),
    mechanisms,
    hasStarttls: /starttls/i.test(text),
    snippet: text.slice(0, 280),
  };
}

function probeWs(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const events = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: "timeout",
        events,
        elapsedMs: Date.now() - started,
      });
    }, timeoutMs);

    let ws;
    try {
      ws = new WebSocket(WS_URL, "xmpp", {
        headers: { Origin: `https://${DOMAIN}` },
        handshakeTimeout: timeoutMs,
      });
    } catch (err) {
      finish({ ok: false, error: String(err), events, elapsedMs: Date.now() - started });
      return;
    }

    ws.on("unexpected-response", (_req, res) => {
      events.push({ type: "unexpected-response", status: res.statusCode });
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        finish({
          ok: false,
          error: "unexpected-response",
          httpStatus: res.statusCode,
          bodySnippet: Buffer.concat(chunks).toString("utf8").slice(0, 200),
          events,
          elapsedMs: Date.now() - started,
        });
      });
    });
    ws.on("open", () => {
      events.push({ type: "open" });
      // XMPP open stream
      ws.send(
        `<open to="${DOMAIN}" version="1.0" xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>`,
      );
    });
    ws.on("message", (data) => {
      const text = data.toString();
      events.push({ type: "message", snippet: text.slice(0, 200) });
      finish({
        ok: true,
        httpStatus: 101,
        events,
        elapsedMs: Date.now() - started,
        firstMessage: text.slice(0, 300),
      });
    });
    ws.on("close", (code, reason) => {
      events.push({ type: "close", code, reason: String(reason) });
      finish({
        ok: false,
        error: "closed",
        closeCode: code,
        events,
        elapsedMs: Date.now() - started,
      });
    });
    ws.on("error", (err) => {
      events.push({ type: "error", message: err.message });
      finish({
        ok: false,
        error: err.message,
        events,
        elapsedMs: Date.now() - started,
      });
    });
  });
}

const bosh = await probeBosh();
const ws = await probeWs();
console.log(JSON.stringify({ domain: DOMAIN, bosh, websocket: ws }, null, 2));
process.exit(ws.ok || bosh.httpStatus === 200 ? 0 : 1);
