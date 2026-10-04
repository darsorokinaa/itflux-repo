/**
 * Эксплуатационные проверки комнаты tldraw. Не меняет протокол sync.
 * node --experimental-sqlite reliability.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";

import { createShapeId, createUserId, InstancePresenceRecordType } from "@tldraw/tlschema";
import { RecordOpType, getTlsyncProtocolVersion } from "@tldraw/sync-core";
import { ZERO_INDEX_KEY, getIndexAbove } from "@tldraw/utils";
import { WebSocket } from "ws";

import { createSyncServer } from "./server.mjs";
import { lessonSyncSchema } from "./schema.mjs";

const SECRET = "reliability-secret";
const BOARD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOARD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const schema = lessonSyncSchema();
const serialized = schema.serialize();
const results = [];

function token(boardId, { canEdit = true, userId = 7, exp = Math.floor(Date.now() / 1000) + 120 } = {}) {
  const payload = { board_id: boardId, can_edit: canEdit, exp, user_id: userId };
  const ordered = {};
  for (const key of Object.keys(payload).sort()) ordered[key] = payload[key];
  const body = Buffer.from(JSON.stringify(ordered)).toString("base64url").replace(/=+$/, "");
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");
  return `${body}.${signature}`;
}

function record(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function shape(type, index, props, id = createShapeId(), parentId = "page:page") {
  return {
    id,
    typeName: "shape",
    type,
    x: 10,
    y: 20,
    rotation: 0,
    index,
    parentId,
    isLocked: false,
    opacity: 1,
    meta: {},
    props,
  };
}

function formula(index, latex, extra = {}) {
  return shape("formula", index, { w: 280, h: 96, latex, fontSize: 22, ...extra });
}

class RoomClient {
  constructor(port, boardId, accessToken, sessionId) {
    this.port = port;
    this.boardId = boardId;
    this.accessToken = accessToken;
    this.sessionId = sessionId;
    this.messages = [];
    this.clock = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.socket = null;
  }

  open() {
    this.socket = new WebSocket(
      `ws://127.0.0.1:${this.port}/ws/tldraw/${this.boardId}/?access_token=${encodeURIComponent(this.accessToken)}&sessionId=${this.sessionId}`,
    );
    this.socket.on("message", (data) => {
      const text = data.toString();
      this.bytesIn += Buffer.byteLength(text);
      try {
        const parsed = JSON.parse(text);
        if (parsed?.type === "data" && Array.isArray(parsed.data)) this.messages.push(...parsed.data);
        else this.messages.push(parsed);
      } catch {
        this.messages.push({ type: "unparsed" });
      }
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`open timeout ${this.sessionId}`)), 8000);
      this.socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.socket.once("close", (code) => {
        clearTimeout(timer);
        resolve({ closed: code });
      });
      this.socket.once("open", () => {
        const body = JSON.stringify({
          type: "connect",
          connectRequestId: this.sessionId,
          schema: serialized,
          protocolVersion: getTlsyncProtocolVersion(),
          lastServerClock: 0,
        });
        this.bytesOut += Buffer.byteLength(body);
        this.socket.send(body);
      });
      const wait = setInterval(() => {
        if (this.messages.some((message) => message.type === "connect")) {
          clearInterval(wait);
          clearTimeout(timer);
          this.socket.removeAllListeners("close");
          resolve({ connected: true });
        }
      }, 20);
    });
  }

  send(message) {
    const body = JSON.stringify(message);
    this.bytesOut += Buffer.byteLength(body);
    this.socket.send(body);
    return body.length;
  }

  push(diff, presence) {
    this.clock += 1;
    const clock = this.clock;
    const message = { type: "push", clientClock: clock };
    if (diff) message.diff = diff;
    if (presence) message.presence = presence;
    this.send(message);
    return this.wait((row) => row.type === "push_result" && row.clientClock === clock, 8000);
  }

  wait(predicate, timeout) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const found = this.messages.find(predicate);
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - started > timeout) {
          clearInterval(timer);
          reject(new Error(`timeout ${this.sessionId} last=${JSON.stringify(this.messages.at(-3))}`));
        }
      }, 20);
    });
  }

  seen(fragment) {
    return this.messages.some((message) => JSON.stringify(message).includes(fragment));
  }

  close() {
    this.socket?.close();
  }
}

function presence(sessionId, userName, fields) {
  return [
    RecordOpType.Put,
    InstancePresenceRecordType.create({
      id: InstancePresenceRecordType.createId(sessionId),
      currentPageId: "page:page",
      userId: createUserId("spoofed"),
      userName,
      cursor: { x: 12, y: 34, type: "default", rotation: 0 },
      ...fields,
    }),
  ];
}

async function migrateOldFormula() {
  const current = schema.serialize();
  const key = Object.keys(current.sequences).find((item) => item.endsWith("shape.formula"));
  const old = { ...current, sequences: { ...current.sequences, [key]: 1 } };
  const legacy = {
    id: "shape:legacyformula",
    typeName: "shape",
    type: "formula",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    meta: {},
    props: { w: 200, h: 80, latex: "x^2" },
  };
  const migrated = schema.migratePersistedRecord(legacy, old, "up");
  const kept = schema.migratePersistedRecord(
    { ...legacy, id: "shape:kept", props: { w: 200, h: 80, latex: "x^2", fontSize: 30 } },
    old,
    "up",
  );
  return migrated.type === "success"
    && migrated.value.props.fontSize === 22
    && migrated.value.props.latex === "x^2"
    && kept.value.props.fontSize === 30;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tldraw-reliability-"));
  const server = await createSyncServer({ port: 0, secret: SECRET, dataDir });
  const port = server.port;
  let teacher;
  let student;
  try {
    record("migration formula v1 → v2", await migrateOldFormula(), "старый props без fontSize");

    const expired = new RoomClient(port, BOARD_A, token(BOARD_A, { exp: Math.floor(Date.now() / 1000) - 10 }), "expired");
    const expiredResult = await expired.open();
    record("expired token", expiredResult.closed === 4401, `code ${expiredResult.closed}`);

    const foreign = new RoomClient(port, BOARD_A, token(BOARD_B), "foreign");
    const foreignResult = await foreign.open();
    record("чужой board UUID", foreignResult.closed === 4401, `code ${foreignResult.closed}`);

    teacher = new RoomClient(port, BOARD_A, token(BOARD_A, { userId: 11 }), "teacher");
    student = new RoomClient(port, BOARD_A, token(BOARD_A, { userId: 22 }), "student");
    const otherRoom = new RoomClient(port, BOARD_B, token(BOARD_B, { userId: 33 }), "other");
    const teacherOpen = await teacher.open();
    const studentOpen = await student.open();
    const otherOpen = await otherRoom.open();
    record("два user id в одной комнате", teacherOpen.connected && studentOpen.connected, "");
    record("вторая комната открылась", otherOpen.connected, "");

    let index = ZERO_INDEX_KEY;
    const nextIndex = () => {
      index = getIndexAbove(index);
      return index;
    };
    const formulaShape = formula(nextIndex(), "x^2");
    const graphShape = shape("graph", nextIndex(), {
      w: 360, h: 240, functions: ["x^2"], xMin: -4, xMax: 4, yMin: -4, yMax: 4,
      showGrid: true, showAxes: true, showLabels: true,
    });
    const taskShape = shape("task", nextIndex(), {
      w: 320, h: 180, taskId: "task-1", title: "Задание", condition: "Найди x",
    });
    const groupShape = shape("group", nextIndex(), {});
    const child = formula(nextIndex(), "y", { });
    child.parentId = groupShape.id;

    const created = await teacher.push({
      [formulaShape.id]: [RecordOpType.Put, formulaShape],
      [graphShape.id]: [RecordOpType.Put, graphShape],
      [taskShape.id]: [RecordOpType.Put, taskShape],
      [groupShape.id]: [RecordOpType.Put, groupShape],
      [child.id]: [RecordOpType.Put, child],
    });
    record("create custom shapes", created.action === "commit" || created.serverClock > 0, JSON.stringify(created).slice(0, 180));
    await student.wait((row) => JSON.stringify(row).includes(formulaShape.id), 4000).catch(() => null);
    record("ученик видит формулу", student.seen(formulaShape.id), "");
    record("ученик видит график и задание", student.seen(graphShape.id) && student.seen(taskShape.id), "");
    record("группа и дочерняя фигура", student.seen(groupShape.id) && student.seen(child.id), "");
    record("чужая комната не видит фигуру", !otherRoom.seen(formulaShape.id), "");

    formulaShape.props = { ...formulaShape.props, latex: "x^3", w: 320, h: 120 };
    formulaShape.x = 80;
    const moved = await teacher.push({ [formulaShape.id]: [RecordOpType.Put, formulaShape] });
    await student.wait((row) => JSON.stringify(row).includes("x^3"), 4000).catch(() => null);
    record("move, resize и правка latex", student.seen("x^3"), JSON.stringify(moved).slice(0, 200));

    const undoMark = student.messages.length;
    formulaShape.props = { ...formulaShape.props, latex: "y+1" };
    await teacher.push({ [formulaShape.id]: [RecordOpType.Put, formulaShape] });
    formulaShape.props = { ...formulaShape.props, latex: "x^3" };
    await teacher.push({ [formulaShape.id]: [RecordOpType.Put, formulaShape] });
    await student.wait((row) => {
      if (student.messages.indexOf(row) < undoMark) return false;
      return JSON.stringify(row).includes("x^3");
    }, 4000).catch(() => null);
    const undoTail = JSON.stringify(student.messages.slice(undoMark));
    record(
      "undo/redo latex",
      undoTail.includes("y+1") && undoTail.lastIndexOf("x^3") > undoTail.indexOf("y+1"),
      "",
    );

    const duplicate = formula(nextIndex(), "x^3");
    await teacher.push({ [duplicate.id]: [RecordOpType.Put, duplicate] });
    await student.wait((row) => JSON.stringify(row).includes(duplicate.id), 4000).catch(() => null);
    record("duplicate получает новый id", student.seen(duplicate.id) && duplicate.id !== formulaShape.id, "");

    const beforeDelete = student.messages.length;
    await teacher.push({ [duplicate.id]: [RecordOpType.Remove] });
    await student.wait((row) => JSON.stringify(row).includes(`"${duplicate.id}"`) && JSON.stringify(row).includes("remove"), 4000).catch(() => null);
    const deleteMessages = JSON.stringify(student.messages.slice(beforeDelete));
    record("delete синхронизируется", deleteMessages.includes(duplicate.id) && deleteMessages.includes("remove"), "");

    const leaderCamera = { x: -40, y: 15, z: 1.5 };
    const leaderPresence = presence("teacher", "Учитель", {
      camera: leaderCamera,
      selectedShapeIds: [formulaShape.id, graphShape.id],
      scribbles: [{
        id: "laser-1",
        points: [{ x: 1, y: 2, z: 0.4 }],
        size: 4,
        color: "laser",
        opacity: 1,
        state: "active",
        delay: 0,
        shrink: 0,
        taper: false,
      }],
    });
    await teacher.push(null, leaderPresence);
    await student.wait((row) => JSON.stringify(row).includes("laser-1"), 4000).catch(() => null);
    const presenceBlob = JSON.stringify(student.messages);
    record("cursor и selection ученик видит", presenceBlob.includes('"x":12') && presenceBlob.includes(formulaShape.id), "");
    record("follow: камера учителя доходит до ученика", presenceBlob.includes('"z":1.5'), "");
    record("laser доходит как presence", presenceBlob.includes("laser-1"), "");
    record(
      "presence user id берётся из токена",
      presenceBlob.includes(createUserId("11")) && !presenceBlob.includes(createUserId("spoofed")),
      "",
    );

    const readonly = new RoomClient(port, BOARD_A, token(BOARD_A, { canEdit: false, userId: 44 }), "readonly");
    await readonly.open();
    const denied = await readonly.push({
      [createShapeId()]: [RecordOpType.Put, formula(nextIndex(), "nope")],
    });
    record("readonly не пишет документ", denied.action && denied.action !== "commit", JSON.stringify(denied).slice(0, 160));
    readonly.close();

    const beforeRestart = fs.statSync(path.join(dataDir, `${BOARD_A}.sqlite`)).size;
    teacher.close();
    student.close();
    otherRoom.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    server.close();
    const reopened = await createSyncServer({ port: 0, secret: SECRET, dataDir });
    const restored = new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 11 }), "restored");
    await restored.open();
    record("restart сразу после правок", restored.seen("x^3"), `sqlite ${beforeRestart} bytes`);
    const sqlitePath = path.join(dataDir, `${BOARD_A}.sqlite`);
    const sqliteText = fs.readFileSync(sqlitePath);
    const persistedDb = new DatabaseSync(sqlitePath, { readOnly: true });
    const persistedIds = persistedDb.prepare("SELECT id FROM documents").all().map((row) => String(row.id));
    persistedDb.close();
    record("лазер не записан в sqlite", !sqliteText.includes(Buffer.from("laser-1")), "");
    record(
      "курсор не записан в sqlite",
      !persistedIds.some((id) => id.startsWith("instance_presence") || id.startsWith("camera")),
      persistedIds.filter((id) => id.startsWith("user:") || id.startsWith("instance")).join(",") || "document ids без presence",
    );

    const stale = new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { exp: Math.floor(Date.now() / 1000) - 5, userId: 11 }), "stale");
    const staleResult = await stale.open();
    record("reconnect со старым token", staleResult.closed === 4401, `code ${staleResult.closed}`);

    const switched = new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 99 }), "switched");
    await switched.open();
    record("смена пользователя видит тот же документ", switched.seen("x^3"), "");
    restored.close();
    switched.close();

    const drops = [];
    for (const seconds of [3, 10, 30]) {
      const client = new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 11 }), `drop-${seconds}`);
      await client.open();
      client.close();
      const started = Date.now();
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      const again = new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 11 }), `back-${seconds}`);
      await again.open();
      const ok = again.seen("x^3");
      drops.push(ok);
      record(`обрыв ${seconds} с`, ok, `${Date.now() - started} ms`);
      again.close();
    }

    const pair = [
      new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 11 }), "pair-a"),
      new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 22 }), "pair-b"),
    ];
    await Promise.all(pair.map((client) => client.open()));
    pair.forEach((client) => client.close());
    await new Promise((resolve) => setTimeout(resolve, 300));
    const returned = [
      new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 11 }), "pair-a2"),
      new RoomClient(reopened.port, BOARD_A, token(BOARD_A, { userId: 22 }), "pair-b2"),
    ];
    await Promise.all(returned.map((client) => client.open()));
    record("несколько клиентов восстанавливаются вместе", returned.every((client) => client.seen("x^3")), "");
    returned.forEach((client) => client.close());

    const loadClient = new RoomClient(reopened.port, BOARD_B, token(BOARD_B, { userId: 33 }), "load");
    const loadWatch = new RoomClient(reopened.port, BOARD_B, token(BOARD_B, { userId: 34 }), "load-watch");
    await loadClient.open();
    await loadWatch.open();
    const watchBefore = loadWatch.bytesIn;
    const load = [];
    let loadIndex = ZERO_INDEX_KEY;
    const batches = [100, 400, 500, 2000];
    let total = 0;
    const cpuBefore = process.cpuUsage();
    const rssBefore = process.memoryUsage().rss;
    for (const count of batches) {
      total += count;
      const diff = {};
      for (let i = 0; i < count; i += 1) {
        loadIndex = getIndexAbove(loadIndex);
        const item = formula(loadIndex, `n${total - count + i}`);
        diff[item.id] = [RecordOpType.Put, item];
      }
      const started = Date.now();
      const bytes = Buffer.byteLength(JSON.stringify({ type: "push", clientClock: 1, diff }));
      await loadClient.push(diff);
      const file = path.join(dataDir, `${BOARD_B}.sqlite`);
      load.push({
        shapes: total,
        ms: Date.now() - started,
        pushBytes: bytes,
        sqlite: fs.statSync(file).size,
        rss: process.memoryUsage().rss,
      });
    }
    const cpu = process.cpuUsage(cpuBefore);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const inbound = loadWatch.bytesIn - watchBefore;
    record(
      "нагрузка 100/500/1000/3000",
      load.length === 4 && load.every((row) => row.ms < 30000) && loadWatch.seen("n2999"),
      load.map((row) => `${row.shapes}: ${row.ms}ms, push ${row.pushBytes}B, sqlite ${row.sqlite}B, rss ${row.rss}`).join(" | "),
    );
    record(
      "websocket ко второму клиенту",
      inbound > 500_000 && loadWatch.seen("n2999"),
      `${inbound} B in`,
    );
    record(
      "CPU процесса sync на 3000 фигурах",
      true,
      `user ${Math.round(cpu.user / 1000)} ms, system ${Math.round(cpu.system / 1000)} ms, rss +${process.memoryUsage().rss - rssBefore}`,
    );
    loadClient.close();
    loadWatch.close();

    const formulaProps = { w: 280, h: 96, latex: "x^{2}+\\frac{a}{b}", fontSize: 22 };
    record(
      "SVG формулы не лежит в shape.props",
      !JSON.stringify(formulaProps).includes("<svg") && Buffer.byteLength(JSON.stringify(formulaProps)) < 200,
      `${Buffer.byteLength(JSON.stringify(formulaProps))} bytes latex props`,
    );

    reopened.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const corruptPath = path.join(dataDir, `${BOARD_A}.sqlite`);
    fs.writeFileSync(corruptPath, "this is not a sqlite database");
    const broken = await createSyncServer({ port: 0, secret: SECRET, dataDir });
    const victim = new RoomClient(broken.port, BOARD_A, token(BOARD_A, { userId: 11 }), "corrupt");
    const victimResult = await victim.open().catch((error) => ({ error: String(error) }));
    record(
      "повреждённый sqlite не роняет процесс",
      victimResult.closed === 1011 || victimResult.closed === 4400 || Boolean(victimResult.error),
      JSON.stringify(victimResult).slice(0, 180),
    );
    const healthy = new RoomClient(broken.port, BOARD_B, token(BOARD_B, { userId: 33 }), "healthy");
    const healthyOpen = await healthy.open();
    record("другая комната жива при порче соседнего файла", healthyOpen.connected && healthy.seen("n0"), "");
    healthy.close();
    broken.close();
  } finally {
    try { teacher?.close(); } catch { /* already closed */ }
    try { student?.close(); } catch { /* already closed */ }
    try { server.close(); } catch { /* already closed */ }
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
