/**
 * Локальный TLS-мост к LiveKit. Слушает только 127.0.0.1.
 * Приложение выдаёт токен только для wss, а сервер LiveKit принимает ws.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const listenPort = Number(process.env.E2E_TLS_PORT || 7883);
const targetPort = Number(process.env.E2E_LIVEKIT_PORT || 7880);
const cert = fs.readFileSync(process.env.E2E_TLS_CERT, "utf8");
const key = fs.readFileSync(process.env.E2E_TLS_KEY, "utf8");

function forwardHeaders(headers) {
  const next = { ...headers, host: `127.0.0.1:${targetPort}` };
  delete next["accept-encoding"];
  return next;
}

const server = https.createServer({ cert, key }, (req, res) => {
  const proxy = http.request(
    {
      host: "127.0.0.1",
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: forwardHeaders(req.headers),
    },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const proxy = http.request({
    host: "127.0.0.1",
    port: targetPort,
    method: "GET",
    path: req.url,
    headers: forwardHeaders(req.headers),
  });
  proxy.on("upgrade", (upstream, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${upstream.statusCode} ${upstream.statusMessage || "Switching Protocols"}`];
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (value == null) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) lines.push(`${name}: ${item}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    const closeBoth = () => {
      upstreamSocket.destroy();
      socket.destroy();
    };
    socket.on("error", closeBoth);
    upstreamSocket.on("error", closeBoth);
  });
  proxy.on("error", () => socket.destroy());
  proxy.end();
});

server.listen(listenPort, "127.0.0.1", () => {
  process.stdout.write(`tls-proxy 127.0.0.1:${listenPort}\n`);
});
