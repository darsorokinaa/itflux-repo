/**
 * Базовая оценка соединения без Speedtest и без Jitsi-комнаты.
 * Не использует navigator.onLine как единственный критерий.
 */

const SAMPLE_COUNT = 4;
const GOOD_RTT_MS = 180;
const FAIR_RTT_MS = 450;
const GOOD_JITTER_MS = 60;
const FAIR_JITTER_MS = 160;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function jitterOf(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function classify(samples, failures) {
  if (!samples.length) {
    return {
      status: "poor",
      label: "Соединение нестабильно",
      detail: "Не удалось проверить связь с сервером. Проверьте интернет и повторите попытку.",
    };
  }
  const avg = mean(samples);
  const jitter = jitterOf(samples);
  if (failures === 0 && avg <= GOOD_RTT_MS && jitter <= GOOD_JITTER_MS) {
    return {
      status: "good",
      label: "Соединение хорошее",
      detail: "Базовая проверка прошла успешно. Это не гарантирует качество звонка, но сейчас связь выглядит стабильной.",
    };
  }
  if (failures <= 1 && avg <= FAIR_RTT_MS && jitter <= FAIR_JITTER_MS) {
    return {
      status: "fair",
      label: "Возможны небольшие задержки",
      detail: "Интернет работает, но связь может быть неровной. Закройте лишние вкладки и при возможности перейдите на более стабильную сеть.",
    };
  }
  return {
    status: "poor",
    label: "Соединение нестабильно",
    detail: "Связь с сервером прерывается или слишком медленная. Проверьте Wi‑Fi или мобильный интернет перед уроком.",
  };
}

async function measure(fetchImpl, url) {
  const started = nowMs();
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const elapsed = nowMs() - started;
  if (!response.ok && response.status >= 500) {
    throw new Error("server");
  }
  return elapsed;
}

export async function probeConnectionQuality({
  url = "/api/cabinet/me/",
  fetchImpl = (typeof fetch === "function" ? fetch.bind(globalThis) : null),
} = {}) {
  if (typeof fetchImpl !== "function") {
    return {
      status: "poor",
      label: "Соединение нестабильно",
      detail: "Не удалось выполнить проверку соединения в этом браузере.",
      sampleCount: 0,
      failureCount: SAMPLE_COUNT,
    };
  }
  const samples = [];
  let failures = 0;
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const probeUrl = `${url}${url.includes("?") ? "&" : "?"}_cc=${Date.now()}-${index}`;
    try {
      samples.push(await measure(fetchImpl, probeUrl));
    } catch {
      failures += 1;
    }
  }
  return {
    ...classify(samples, failures),
    sampleCount: samples.length,
    failureCount: failures,
  };
}
