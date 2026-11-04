import { useEffect, useState } from "react";

// r143: флаг России у логотипа только 4 ноября 2026 (День народного единства), по Москве (UTC+3).
const START_MS = Date.UTC(2026, 10, 3, 21, 0, 0); // 2026-11-04 00:00 MSK
const END_MS = Date.UTC(2026, 10, 4, 21, 0, 0); // 2026-11-05 00:00 MSK

export function isUnityDayActive(now: number = Date.now()): boolean {
  return now >= START_MS && now < END_MS;
}

export default function UnityDayFlag() {
  const [active, setActive] = useState(() => isUnityDayActive());
  useEffect(() => {
    if (Date.now() >= END_MS) return undefined;
    const id = window.setInterval(() => setActive(isUnityDayActive()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!active) return null;
  return (
    <svg
      className="flux-brand-flag"
      role="img"
      aria-label="Флаг России"
      viewBox="0 0 27 18"
      width={27}
      height={18}
    >
      <title>Флаг России</title>
      <defs>
        <clipPath id="flux-ru-flag-clip"><rect width="27" height="18" rx="3" /></clipPath>
      </defs>
      <g clipPath="url(#flux-ru-flag-clip)">
        <rect width="27" height="6" fill="#ffffff" />
        <rect y="6" width="27" height="6" fill="#0039a6" />
        <rect y="12" width="27" height="6" fill="#d52b1e" />
      </g>
      <rect x="0.5" y="0.5" width="26" height="17" rx="2.5" fill="none" stroke="rgba(0,0,0,0.18)" />
    </svg>
  );
}
