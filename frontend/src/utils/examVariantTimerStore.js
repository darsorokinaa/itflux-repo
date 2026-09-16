/**
 * Таймер варианта без setState в ExamPage — только подписчики (сайдбар, уголок) перерисовываются раз в секунду.
 * Источник истины: startedAt, а не локальный increment. Remount/minimize не обнуляют время.
 */
export function createExamVariantTimerStore() {
  let startedAtMs = null;
  let pauseAccumulatedMs = 0;
  let pauseStartedAtMs = null;
  let status = "idle";
  let cachedSeconds = 0;
  const listeners = new Set();
  let intervalId = null;

  const elapsedMs = (now = Date.now()) => {
    if (startedAtMs == null || status === "idle") return 0;
    const pausedExtra = status === "paused" && pauseStartedAtMs != null
      ? now - pauseStartedAtMs
      : 0;
    return Math.max(0, now - startedAtMs - pauseAccumulatedMs - pausedExtra);
  };

  const refreshSeconds = () => {
    cachedSeconds = Math.max(0, Math.floor(elapsedMs() / 1000));
    return cachedSeconds;
  };

  const notify = () => {
    refreshSeconds();
    listeners.forEach((l) => l());
  };

  const clearTick = () => {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const startTick = () => {
    clearTick();
    intervalId = setInterval(() => {
      notify();
    }, 1000);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSeconds() {
      return cachedSeconds;
    },
    getStatus() {
      return status;
    },
    getStartedAtIso() {
      return startedAtMs == null ? null : new Date(startedAtMs).toISOString();
    },
    setStatus(next) {
      const n = next === "running" || next === "paused" || next === "idle" ? next : "idle";
      if (n === status) return;
      const now = Date.now();
      if (n === "running") {
        if (startedAtMs == null) startedAtMs = now;
        if (status === "paused" && pauseStartedAtMs != null) {
          pauseAccumulatedMs += now - pauseStartedAtMs;
          pauseStartedAtMs = null;
        }
        startTick();
      } else if (n === "paused") {
        if (status === "running") pauseStartedAtMs = now;
        clearTick();
      } else {
        clearTick();
      }
      status = n;
      notify();
    },
    restoreFromStartedAt(startedAt) {
      const ms = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
      if (!Number.isFinite(ms) || ms <= 0) return null;
      startedAtMs = ms;
      pauseAccumulatedMs = 0;
      pauseStartedAtMs = null;
      status = "running";
      startTick();
      notify();
      return new Date(ms).toISOString();
    },
    nudge() {
      notify();
    },
    reset() {
      startedAtMs = null;
      pauseAccumulatedMs = 0;
      pauseStartedAtMs = null;
      cachedSeconds = 0;
      notify();
    },
    destroy() {
      clearTick();
      listeners.clear();
    },
  };
}
