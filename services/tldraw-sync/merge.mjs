/**
 * Объединение досок ученика в одну (на стороне sync-сервера, через живую комнату).
 * Комната-цель меняется только через room.updateStore — подключённые клиенты получают
 * изменения штатной синхронизацией и не перезатирают их. Исходные комнаты только читаются.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getIndicesBelow, getIndicesAbove } from "@tldraw/utils";

import { convertExcalidrawToTldraw } from "./excalidrawConvert.mjs";

const COPY_TYPES = new Set(["page", "shape", "binding", "asset"]);
export const MERGE_META_KEY = "itfluxMerge";

function rid(prefix) {
  return `${prefix}:m${crypto.randomBytes(9).toString("base64url")}`;
}

function deepMap(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => deepMap(v, fn));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepMap(v, fn);
    return out;
  }
  return value;
}

function makeRewriter(idMap, urlMap) {
  const urls = Object.entries(urlMap || {}).filter(([a, b]) => a && b);
  return (s) => {
    const mapped = idMap.get(s);
    if (mapped) return mapped;
    if (urls.length && (s.includes("/assets/") || s.includes("/media/"))) {
      let out = s;
      for (const [a, b] of urls) if (out.includes(a)) out = out.split(a).join(b);
      return out;
    }
    return s;
  };
}

/** Записи страниц источника: [{page, records}] в порядке листов. */
function groupByPage(records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const pages = records.filter((r) => r.typeName === "page")
    .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  const pageOf = (rec) => {
    let cur = rec;
    for (let i = 0; i < 1000 && cur; i += 1) {
      if (typeof cur.parentId === "string" && cur.parentId.startsWith("page:")) return cur.parentId;
      cur = byId.get(cur.parentId);
    }
    return null;
  };
  const groups = pages.map((page) => ({ page, records: [] }));
  const index = new Map(groups.map((g) => [g.page.id, g]));
  const shared = [];
  for (const rec of records) {
    if (rec.typeName === "shape") {
      const g = index.get(pageOf(rec));
      if (g) g.records.push(rec);
    } else if (rec.typeName === "binding" || rec.typeName === "asset") {
      shared.push(rec);
    }
  }
  return { groups: groups.filter((g) => g.records.length), shared };
}

/**
 * parts: [{source_id, label, kind: "room"|"excalidraw", scene?}] — в хронологическом порядке.
 * getRoom(id) — живая комната; snapshotOf(id) — документы источника.
 */
export async function mergeIntoRoom({ targetRoom, parts, urlMap, mergeId, snapshotOf }) {
  const prepared = []; // {label, sourceId, records}
  let shared = [];
  for (const part of parts) {
    if (part.kind === "room") {
      const docs = snapshotOf(part.source_id).filter((r) => COPY_TYPES.has(r.typeName));
      const { groups, shared: sh } = groupByPage(docs);
      shared = shared.concat(sh);
      groups.forEach((g, i) => prepared.push({
        label: groups.length > 1 ? `${part.label} · ${i + 1}` : part.label,
        sourceId: part.source_id,
        page: g.page,
        records: g.records,
      }));
    } else if (part.kind === "excalidraw") {
      const tmpPage = "page:excal";
      const recs = convertExcalidrawToTldraw(part.scene, { pageId: tmpPage });
      const shapes = recs.filter((r) => r.typeName === "shape");
      if (!shapes.length) continue;
      shared = shared.concat(recs.filter((r) => r.typeName === "asset" || r.typeName === "binding"));
      prepared.push({
        label: part.label,
        sourceId: part.source_id,
        page: { id: tmpPage, typeName: "page", name: part.label, index: "a1", meta: {} },
        records: shapes,
        fresh: true,
      });
    }
  }
  if (!prepared.length) return { pages: 0, shapes: 0 };

  let result = { pages: 0, shapes: 0 };
  await targetRoom.updateStore((store) => {
    const existing = store.getAll();
    const existingPages = existing.filter((r) => r.typeName === "page")
      .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
    const taken = new Set(existingPages.map((p) => p.name));
    const minIndex = existingPages[0]?.index ?? null;
    const indices = minIndex ? getIndicesBelow(minIndex, prepared.length) : getIndicesAbove(null, prepared.length);
    const out = [];
    prepared.forEach((item, i) => {
      const idMap = new Map();
      const newPageId = rid("page");
      idMap.set(item.page.id, newPageId);
      // id в каждом листе свои: один источник с несколькими листами делит shared-записи.
      for (const r of item.records) idMap.set(r.id, rid(r.typeName));
      let name = item.label;
      for (let n = 2; taken.has(name); n += 1) name = `${item.label} (${n})`;
      taken.add(name);
      const rewrite = makeRewriter(idMap, urlMap);
      out.push({
        ...item.page,
        id: newPageId,
        name,
        index: indices[i],
        meta: { ...(item.page.meta || {}), [MERGE_META_KEY]: { mergeId, sourceId: item.sourceId } },
      });
      for (const r of item.records) out.push(deepMap(r, rewrite));
      item.idMap = idMap;
      result.pages += 1;
      result.shapes += item.records.length;
    });
    // Ассеты и связи: id сохраняем, если не заняты в цели, иначе переименовываем во всех листах.
    const existingIds = new Set(existing.map((r) => r.id));
    const sharedMap = new Map();
    const assetsSeen = new Set();
    for (const r of shared) {
      if (r.typeName === "asset" && !assetsSeen.has(r.id)) {
        assetsSeen.add(r.id);
        sharedMap.set(r.id, existingIds.has(r.id) ? rid("asset") : r.id);
      } else if (r.typeName === "binding") {
        sharedMap.set(r.id, rid("binding"));
      }
    }
    const allIds = new Map();
    for (const item of prepared) for (const [a, b] of item.idMap) allIds.set(a, b);
    for (const [a, b] of sharedMap) allIds.set(a, b);
    const rewriteAll = makeRewriter(allIds, urlMap);
    const putIds = new Set();
    for (const rec of out.map((r) => deepMap(r, (s) => (sharedMap.has(s) ? sharedMap.get(s) : s)))) {
      store.put(rec);
      putIds.add(rec.id);
    }
    for (const r of shared) {
      if (!sharedMap.has(r.id)) continue;
      const rec = deepMap({ ...r }, rewriteAll);
      if (rec.typeName === "binding" && !(putIds.has(rec.fromId) && putIds.has(rec.toId))) continue;
      if (putIds.has(rec.id)) continue;
      if (rec.typeName === "asset") rec.meta = { ...(rec.meta || {}), [MERGE_META_KEY]: { mergeId } };
      store.put(rec);
      putIds.add(rec.id);
    }
  });
  return result;
}

/** Откат: убрать листы этого объединения и их фигуры. */
export async function unmergeRoom({ targetRoom, mergeId }) {
  let removed = 0;
  await targetRoom.updateStore((store) => {
    const all = store.getAll();
    const pages = new Set(all.filter((r) => r.typeName === "page" && r.meta?.[MERGE_META_KEY]?.mergeId === mergeId).map((r) => r.id));
    if (!pages.size) return;
    const byId = new Map(all.map((r) => [r.id, r]));
    const onPage = (rec) => {
      let cur = rec;
      for (let i = 0; i < 1000 && cur; i += 1) {
        if (pages.has(cur.parentId)) return true;
        cur = byId.get(cur.parentId);
      }
      return false;
    };
    const shapeIds = new Set(all.filter((r) => r.typeName === "shape" && onPage(r)).map((r) => r.id));
    for (const r of all) {
      const drop = pages.has(r.id) || shapeIds.has(r.id)
        || (r.typeName === "binding" && (shapeIds.has(r.fromId) || shapeIds.has(r.toId)))
        || (r.typeName === "asset" && r.meta?.[MERGE_META_KEY]?.mergeId === mergeId);
      if (drop) { store.delete(r.id); removed += 1; }
    }
  });
  return { removed };
}

export function backupRoomFile(db, dataDir, boardId) {
  const dir = path.join(dataDir, "merge-backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${boardId}.${Date.now()}.sqlite`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}
