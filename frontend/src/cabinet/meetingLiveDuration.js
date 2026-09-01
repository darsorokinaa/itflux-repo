/** Лимит длительности видеозвонка: предупреждение, затем автозакрытие. */

export const MAX_LIVE_MS = 2 * 60 * 60 * 1000;
export const LIVE_WARN_MS = MAX_LIVE_MS - 15 * 60 * 1000;

export function liveElapsedMs(startedAt, now = Date.now()) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Number(now) - started);
}

export function classifyLiveDurationUi({
  startedAt = "",
  now = Date.now(),
  canManage = false,
} = {}) {
  const elapsed = liveElapsedMs(startedAt, now);
  if (!startedAt || elapsed < LIVE_WARN_MS) {
    return {
      phase: "ok",
      title: "",
      text: "",
      showFinish: false,
      elapsedMs: elapsed,
    };
  }
  if (elapsed >= MAX_LIVE_MS) {
    return {
      phase: "overdue",
      title: canManage ? "Звонок закрывается" : "Урок завершается",
      text: canManage
        ? "Лимит 2 часов истёк. Завершите этот урок. Если занятие продолжается — создайте новый."
        : "Звонок идёт уже больше 2 часов и скоро закроется автоматически.",
      showFinish: Boolean(canManage),
      elapsedMs: elapsed,
    };
  }
  return {
    phase: "warn",
    title: canManage ? "Пора завершить этот урок" : "Урок скоро завершится",
    text: canManage
      ? "Звонок идёт уже почти 2 часа. Завершите его здесь. Если занятие продолжается — создайте новый урок. Иначе звонок закроется автоматически."
      : "Звонок идёт уже давно. Учитель может закрыть комнату автоматически.",
    showFinish: Boolean(canManage),
    elapsedMs: elapsed,
  };
}
