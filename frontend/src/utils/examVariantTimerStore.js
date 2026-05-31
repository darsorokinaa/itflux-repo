/**
 * Таймер варианта без setState в ExamPage — только подписчики (сайдбар, уголок) перерисовываются раз в секунду.
 */
export function createExamVariantTimerStore() {
  let seconds = 0;
  let status = "idle";
  const listeners = new Set();
  let intervalId = null;

  const notify = () => {
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
      seconds += 1;
      notify();
    }, 1000);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSeconds() {
      return seconds;
    },
    getStatus() {
      return status;
    },
    setStatus(next) {
      const n = next === "running" || next === "paused" || next === "idle" ? next : "idle";
      if (n === status) return;
      status = n;
      if (n === "running") startTick();
      else clearTick();
      notify();
    },
    reset() {
      seconds = 0;
      notify();
    },
    destroy() {
      clearTick();
      listeners.clear();
    },
  };
}
