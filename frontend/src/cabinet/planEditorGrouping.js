export function topicKeyOf(session) {
  return String(session?.topic || "").trim();
}

export function lessonsWord(n) {
  const abs = Math.abs(Number(n) || 0);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "урок";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "урока";
  return "уроков";
}

export function topicsWord(n) {
  const abs = Math.abs(Number(n) || 0);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "тема";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "темы";
  return "тем";
}

export function groupSessionsByTopic(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const groups = [];
  list.forEach((session, index) => {
    const topicKey = topicKeyOf(session);
    const last = groups[groups.length - 1];
    if (last && last.topicKey === topicKey) {
      last.indices.push(index);
      return;
    }
    groups.push({
      id: `topic-${index}`,
      topicKey,
      topic: topicKey,
      indices: [index],
    });
  });
  return groups;
}

export function uniquePlanTopics(sessions) {
  const seen = new Set();
  const topics = [];
  (sessions || []).forEach((session) => {
    const topic = topicKeyOf(session);
    if (!topic || seen.has(topic)) return;
    seen.add(topic);
    topics.push(topic);
  });
  return topics;
}

export function shouldShowTopicChrome(groups) {
  if (!groups?.length) return false;
  return groups.some((group) => group.topicKey);
}

export function moveListItem(list, fromIndex, toIndex) {
  if (!Array.isArray(list)) return list;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list;
  if (fromIndex >= list.length || toIndex > list.length) return list;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  const insertAt = Math.min(toIndex, next.length);
  next.splice(insertAt, 0, moved);
  return next;
}

export function mapIndexAfterMove(index, fromIndex, toIndex) {
  if (index == null) return index;
  if (index === fromIndex) return toIndex;
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
  if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
  return index;
}

export function mapIndexAfterInsert(index, insertAt) {
  if (index == null) return index;
  return index >= insertAt ? index + 1 : index;
}

export function mapIndexAfterRemove(index, removedAt) {
  if (index == null) return index;
  if (index === removedAt) return removedAt > 0 ? removedAt - 1 : 0;
  if (index > removedAt) return index - 1;
  return index;
}

export function visualDropLineIndex(draggingIndex, dropIndex, count) {
  if (draggingIndex == null || dropIndex == null || count <= 0) return null;
  let seen = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === draggingIndex) continue;
    if (seen === dropIndex) return i;
    seen += 1;
  }
  return count;
}

export function dropIndexFromY(clientY, rects, fromIndex) {
  if (!Array.isArray(rects) || !rects.length) return fromIndex;
  const others = [];
  for (let i = 0; i < rects.length; i += 1) {
    if (i === fromIndex) continue;
    others.push({ rect: rects[i], i });
  }
  let insertAt = others.length;
  for (let n = 0; n < others.length; n += 1) {
    const rect = others[n].rect;
    if (!rect) continue;
    const mid = rect.top + (rect.height || 0) / 2;
    if (clientY < mid) {
      insertAt = n;
      break;
    }
  }
  return insertAt;
}

export function destinationTopic(sessions, fromIndex, toIndex) {
  const next = moveListItem(sessions, fromIndex, toIndex);
  if (!next[toIndex]) return "";
  const before = next[toIndex - 1];
  const after = next[toIndex + 1];
  const beforeKey = topicKeyOf(before);
  const afterKey = topicKeyOf(after);
  if (beforeKey && beforeKey === afterKey) return beforeKey;
  if (afterKey) return afterKey;
  if (beforeKey) return beforeKey;
  return topicKeyOf(next[toIndex]);
}

export function applyReorderWithTopic(sessions, fromIndex, toIndex) {
  if (fromIndex === toIndex) return sessions;
  const next = moveListItem(sessions, fromIndex, toIndex);
  const destTopic = destinationTopic(sessions, fromIndex, toIndex);
  const current = next[toIndex];
  if (!current) return next;
  if (topicKeyOf(current) === destTopic) return next;
  next[toIndex] = { ...current, topic: destTopic };
  return next;
}

export function moveSessionToTopic(sessions, index, topic) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list[index]) return list;
  const nextTopic = String(topic || "").trim();
  const without = list.filter((_, i) => i !== index);
  let insertAt = without.length;
  for (let i = without.length - 1; i >= 0; i -= 1) {
    if (topicKeyOf(without[i]) === nextTopic) {
      insertAt = i + 1;
      break;
    }
  }
  const moved = { ...list[index], topic: nextTopic };
  without.splice(insertAt, 0, moved);
  return without;
}

export function renameTopicInRange(sessions, indices, nextTopic) {
  const topic = String(nextTopic || "").trim();
  const set = new Set(indices || []);
  return (sessions || []).map((session, index) => (
    set.has(index) ? { ...session, topic } : session
  ));
}
