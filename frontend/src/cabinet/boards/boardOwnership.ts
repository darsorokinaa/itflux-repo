/** Владение элементами доски (customData.itflux). */

export const OWNER_KEY = "itfluxOwnerId";
export const OWNER_ROLE_KEY = "itfluxOwnerRole";
export const OWNERSHIP = "itfluxOwnership"; // teacher | student | shared

export type BoardOwnerRole = "teacher" | "student" | "viewer" | string;

type El = {
  id?: string;
  isDeleted?: boolean;
  customData?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export function getElementOwnerId(el: unknown): number | null {
  if (!el || typeof el !== "object") return null;
  const data = (el as El).customData;
  if (!data || typeof data !== "object") return null;
  const raw = data[OWNER_KEY];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getElementOwnership(el: unknown): string {
  if (!el || typeof el !== "object") return "shared";
  const data = (el as El).customData;
  if (!data || typeof data !== "object") return "shared";
  return String(data[OWNERSHIP] || "shared");
}

/** Проставить владельца только на новых элементах без owner. */
export function stampElementOwnership(
  elements: readonly unknown[],
  prevIds: Set<string>,
  userId: number | null | undefined,
  role: BoardOwnerRole,
): unknown[] {
  if (!userId) return elements as unknown[];
  const ownership = role === "teacher" ? "teacher" : "student";
  let changed = false;
  const out = (elements as El[]).map((el) => {
    if (!el || typeof el !== "object" || !el.id) return el;
    if (prevIds.has(el.id)) return el;
    const data = (el.customData && typeof el.customData === "object")
      ? { ...el.customData }
      : {};
    if (data[OWNER_KEY] != null) return el;
    data[OWNER_KEY] = userId;
    data[OWNER_ROLE_KEY] = role || "student";
    data[OWNERSHIP] = ownership;
    // Мутируем live-объект Excalidraw: иначе shallow-copy «замораживает»
    // штрих на первой точке, а пир видит точки рывками.
    (el as El).customData = data;
    changed = true;
    return el;
  });
  return changed ? out : (elements as unknown[]);
}

/**
 * Ученик не может удалять/менять элементы учителя.
 * Учитель может всё. Владелец — свои. shared — все с edit.
 */
export function canMutateElement(
  el: unknown,
  opts: {
    actorUserId: number | null | undefined;
    actorRole: BoardOwnerRole;
    canManage: boolean;
  },
): boolean {
  const { actorUserId, actorRole, canManage } = opts;
  if (canManage || actorRole === "teacher") return true;
  const ownership = getElementOwnership(el);
  if (ownership === "shared") return true;
  if (ownership === "teacher") return false;
  const ownerId = getElementOwnerId(el);
  if (ownerId == null) return true;
  return Number(ownerId) === Number(actorUserId);
}

/** Отфильтровать недопустимые мутации относительно предыдущей сцены. */
export function filterUnauthorizedMutations(
  prevElements: unknown[],
  nextElements: unknown[],
  opts: {
    actorUserId: number | null | undefined;
    actorRole: BoardOwnerRole;
    canManage: boolean;
  },
): unknown[] {
  if (opts.canManage || opts.actorRole === "teacher") return nextElements;
  const prevMap = new Map<string, El>();
  for (const raw of prevElements || []) {
    if (raw && typeof raw === "object" && (raw as El).id) {
      prevMap.set(String((raw as El).id), raw as El);
    }
  }
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const raw of nextElements || []) {
    if (!raw || typeof raw !== "object" || !(raw as El).id) {
      out.push(raw);
      continue;
    }
    const el = raw as El;
    const id = String(el.id);
    seen.add(id);
    const prev = prevMap.get(id);
    if (!prev) {
      // Новый элемент — ок.
      out.push(el);
      continue;
    }
    if (!canMutateElement(prev, opts)) {
      out.push(prev);
      continue;
    }
    out.push(el);
  }
  // Нельзя «удалить» чужой элемент, просто исключив его из next.
  for (const [id, prev] of prevMap) {
    if (seen.has(id)) continue;
    if (!canMutateElement(prev, opts)) {
      out.push(prev);
    } else {
      // Локальное hard-remove разрешённого — оставляем soft-delete если был в next как deleted;
      // иначе элемент исчез — допустимо для своих.
    }
  }
  return out;
}
