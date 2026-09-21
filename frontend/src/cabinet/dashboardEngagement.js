/** Выбор одной карточки дашборда и память, чтобы редкое не повторялось слишком часто. */

const STORAGE_PREFIX = "itflux.teacherPulse.v1.";

export function localIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyMemory() {
  return {
    shownToday: null,
    seenAt: {},
    weekId: "",
    weekDate: "",
    noteToday: null,
    noteRecent: [],
  };
}

export function readMemory(userId, storage = globalThis.localStorage) {
  if (userId == null || !storage) return emptyMemory();
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return emptyMemory();
    const parsed = JSON.parse(raw);
    return { ...emptyMemory(), ...parsed, seenAt: parsed.seenAt || {}, noteRecent: parsed.noteRecent || [] };
  } catch {
    return emptyMemory();
  }
}

export function writeMemory(userId, memory, storage = globalThis.localStorage) {
  if (userId == null || !storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(memory));
  } catch {
    /* приватный режим не должен ломать дашборд */
  }
}

export function daysBetween(fromIso, toIso) {
  const start = Date.parse(`${fromIso}T00:00:00`);
  const end = Date.parse(`${toIso}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86400000);
}

export function chooseNote(candidates, memory, todayIso) {
  const list = candidates || [];
  const state = memory || emptyMemory();
  if (state.noteToday?.date === todayIso && state.noteToday.id) {
    const sticky = list.find((item) => item.id === state.noteToday.id);
    if (sticky) return sticky;
    if (state.noteToday.text) return { id: state.noteToday.id, text: state.noteToday.text };
  }
  const recent = new Set(state.noteRecent || []);
  return list.find((item) => !recent.has(item.id)) || list[0] || null;
}

function presentNote(card, note) {
  return {
    ...card,
    id: note.id,
    title: note.text,
    body: "",
    candidates: [],
  };
}

function blocked(card, memory, todayIso) {
  if (card.kind === "recommendation" || card.kind === "note") return false;
  if (card.kind === "week") {
    return Boolean(memory.weekId) && memory.weekId === card.id && memory.weekDate !== todayIso;
  }
  const seen = memory.seenAt?.[card.id];
  if (!seen) return false;
  const cooldown = Number(card.cooldown_days) || 0;
  if (cooldown <= 0) return false;
  return daysBetween(seen, todayIso) < cooldown;
}

function resolveSticky(cards, stickyId, memory) {
  for (const card of cards) {
    if (card.kind === "note") {
      const found = (card.candidates || []).find((item) => item.id === stickyId);
      if (found) return presentNote(card, found);
      if (memory.noteToday?.id === stickyId && memory.noteToday.text) {
        return presentNote(card, memory.noteToday);
      }
    } else if (card.id === stickyId) {
      return card;
    }
  }
  return null;
}

export function pickSpotlight(engagement, memory, todayIso) {
  const cards = engagement?.cards || [];
  const state = memory || emptyMemory();
  const stickyId = state.shownToday?.date === todayIso ? state.shownToday.id : "";
  if (stickyId) {
    const sticky = resolveSticky(cards, stickyId, state);
    if (sticky) return sticky;
  }
  for (const card of cards) {
    if (blocked(card, state, todayIso)) continue;
    if (card.kind === "note") {
      const note = chooseNote(card.candidates, state, todayIso);
      if (!note) continue;
      return presentNote(card, note);
    }
    return card;
  }
  return null;
}

export function rememberDailyNote(memory, note, todayIso) {
  const next = {
    ...emptyMemory(),
    ...memory,
    seenAt: { ...(memory?.seenAt || {}) },
    noteRecent: [...(memory?.noteRecent || [])],
  };
  if (!note?.id) return next;
  next.noteToday = { date: todayIso, id: note.id, text: note.text || "" };
  if (!next.noteRecent.includes(note.id)) next.noteRecent.push(note.id);
  next.noteRecent = next.noteRecent.slice(-28);
  return next;
}

export function rememberSpotlight(memory, card, todayIso) {
  const next = {
    ...emptyMemory(),
    ...memory,
    seenAt: { ...(memory?.seenAt || {}) },
    noteRecent: [...(memory?.noteRecent || [])],
  };
  if (!card) return next;
  next.shownToday = { date: todayIso, id: card.id };
  if (card.kind === "note") {
    next.noteToday = { date: todayIso, id: card.id, text: card.title || "" };
    if (!next.noteRecent.includes(card.id)) next.noteRecent.push(card.id);
    next.noteRecent = next.noteRecent.slice(-28);
  }
  if (card.kind === "week") {
    next.weekId = card.id;
    next.weekDate = todayIso;
  }
  const cooldown = Number(card.cooldown_days) || 0;
  if (cooldown > 0 && card.kind !== "note" && card.kind !== "recommendation" && card.kind !== "week") {
    if (!next.seenAt[card.id]) next.seenAt[card.id] = todayIso;
  }
  return next;
}
