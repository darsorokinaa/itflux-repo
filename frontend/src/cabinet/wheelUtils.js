export const WHEEL_SEGMENT_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
  "#F97316",
  "#6366F1",
];

export const DEFAULT_WHEEL_SETTINGS = {
  shuffle_segments: false,
  allow_repeat: true,
  remove_after_spin: false,
  show_result_modal: true,
  spin_duration: 4,
  sound_enabled: true,
};

export const SPIN_DURATION_CHIPS = [
  { value: 3, label: "3 сек" },
  { value: 4, label: "4 сек" },
  { value: 5, label: "5 сек" },
  { value: 6, label: "6 сек" },
];

export function createEmptySegment(order = 1) {
  return {
    id: `ws${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    title: "",
    description: "",
    color: WHEEL_SEGMENT_COLORS[(order - 1) % WHEEL_SEGMENT_COLORS.length],
    points: 1,
    order,
  };
}

export function getSegmentPoints(segment) {
  const raw = segment?.points;
  if (raw === null || raw === undefined || raw === "") return 1;
  return Math.max(0, Number(raw) || 0);
}

export function formatWheelPoints(n) {
  const num = Number(n) || 0;
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return `${num} балл`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${num} балла`;
  return `${num} баллов`;
}

export function normalizeWheelSettings(settings) {
  const merged = { ...DEFAULT_WHEEL_SETTINGS, ...(settings || {}) };
  merged.spin_duration = Number(merged.spin_duration) || DEFAULT_WHEEL_SETTINGS.spin_duration;
  return merged;
}

export function getWheelSettings(interactive) {
  return normalizeWheelSettings(interactive?.wheelSettings);
}

export function getWheelSegments(interactive) {
  return [...(interactive?.segments || [])].sort(
    (a, b) => (a.order || 0) - (b.order || 0),
  );
}

export function getValidWheelSegments(interactive) {
  return getWheelSegments(interactive).filter((s) => (s.title || "").trim());
}

export function wheelCanPublish(interactive) {
  return getValidWheelSegments(interactive).length >= 2;
}

export function wheelPublishError(interactive) {
  if (wheelCanPublish(interactive)) return "";
  return "Для публикации нужно минимум 2 сектора с названием";
}

export function wheelHasPlayableContent(interactive) {
  return getValidWheelSegments(interactive).length >= 2;
}

export function reorderWheelSegments(segments, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return segments;
  const next = [...segments];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((item, index) => ({ ...item, order: index + 1 }));
}

export function shuffleWheelSegments(segments) {
  const copy = [...segments];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function duplicateWheelSegment(segments, index) {
  const source = segments[index];
  if (!source) return segments;
  const copy = {
    ...source,
    id: createEmptySegment().id,
    title: source.title ? `${source.title}` : "",
    order: segments.length + 1,
  };
  return [...segments, copy].map((item, i) => ({ ...item, order: i + 1 }));
}

/** Сектора, доступные для следующего спина */
export function getPickableWheelSegments(pool, settings, usedIds = []) {
  if (settings.allow_repeat === false) {
    return pool.filter((s) => !usedIds.includes(s.id));
  }
  return pool;
}

export function wheelCanSpin(pool, settings, usedIds = [], { spinDisabled = false, spinning = false } = {}) {
  if (spinDisabled || spinning) return false;
  if (pool.length < 2) return false;
  return getPickableWheelSegments(pool, settings, usedIds).length > 0;
}

export function wheelCanSpinAgain(pool, settings, usedIds = [], lastSegmentId = null) {
  let nextPool = pool;
  let nextUsed = usedIds;

  if (lastSegmentId) {
    if (settings.remove_after_spin) {
      nextPool = pool.filter((s) => s.id !== lastSegmentId);
    }
    if (settings.allow_repeat === false) {
      nextUsed = usedIds.includes(lastSegmentId) ? usedIds : [...usedIds, lastSegmentId];
    }
  }

  if (nextPool.length < 2) return false;
  return getPickableWheelSegments(nextPool, settings, nextUsed).length > 0;
}

/** Выбор сектора с учётом повторов и уже выпавших */
export function pickWheelSegment(segments, { allowRepeat = true, usedIds = [] } = {}) {
  let pool = segments;
  if (!allowRepeat) {
    pool = segments.filter((s) => !usedIds.includes(s.id));
    if (!pool.length) return null;
  }
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const index = segments.findIndex((s) => s.id === picked.id);
  return { segment: picked, index: index >= 0 ? index : 0 };
}

/** Конечный угол вращения (deg) для deterministic spin — указатель сверху */
export function computeWheelTargetRotation({
  segmentIndex,
  segmentCount,
  currentRotation = 0,
  extraSpins = 5,
}) {
  if (!segmentCount) return currentRotation;
  const slice = 360 / segmentCount;
  const targetOffset = 360 - (segmentIndex * slice + slice / 2);
  const normalized = ((currentRotation % 360) + 360) % 360;
  let delta = extraSpins * 360 + targetOffset - normalized;
  if (delta < slice) delta += 360;
  return currentRotation + delta;
}

export function polarToCartesian(cx, cy, radius, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

export function describeWheelSlice(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

/** Ширина текстового блока в секторе (px) */
export function getWheelLabelBoxWidth(radius, segmentCount) {
  if (!segmentCount) return 48;
  const sliceRad = (2 * Math.PI) / segmentCount;
  const labelRadius = radius * 0.58;
  const chord = 2 * labelRadius * Math.sin(sliceRad / 2);
  return Math.max(28, Math.min(96, chord * 0.88));
}

export function getWheelLabelLayout(segmentCount, compact) {
  if (segmentCount <= 4) {
    return { fontSize: compact ? 20 : 24, maxLines: 3 };
  }
  if (segmentCount <= 6) {
    return { fontSize: compact ? 18 : 22, maxLines: 2 };
  }
  if (segmentCount <= 10) {
    return { fontSize: compact ? 16 : 20, maxLines: 2 };
  }
  return { fontSize: compact ? 14 : 16, maxLines: 2 };
}
