import { useEffect, useMemo, useState } from "react";

const PARTICLE_TYPES = new Set(["falling-leaves", "snow", "floating-stars", "clouds"]);

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function particleCount(type, isNarrow) {
  if (type === "clouds") return isNarrow ? 3 : 5;
  if (type === "floating-stars") return isNarrow ? 10 : 16;
  return isNarrow ? 8 : 14;
}

export default function ThemeEffects({ type }) {
  const [reduced, setReduced] = useState(() => (typeof window === "undefined" ? false : prefersReducedMotion()));
  const [narrow, setNarrow] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < 900));
  const motionType = String(type || "none").toLowerCase();
  const showParticles = PARTICLE_TYPES.has(motionType);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReduced(mq.matches);
    const onResize = () => setNarrow(window.innerWidth < 900);
    mq.addEventListener?.("change", onMotion);
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      mq.removeEventListener?.("change", onMotion);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const items = useMemo(() => {
    if (!showParticles || reduced) return [];
    const n = particleCount(motionType, narrow);
    return Array.from({ length: n }, (_, index) => ({
      id: `${motionType}-${index}`,
      left: `${(index * 83) % 100}%`,
      delay: `${(index % 7) * 0.7}s`,
      duration: `${10 + (index % 6) * 2}s`,
      size: `${10 + (index % 5) * 4}px`,
    }));
  }, [motionType, narrow, reduced, showParticles]);

  if (reduced || motionType === "none" || motionType === "plane-route" || motionType === "travel-route") return null;

  if (!showParticles || !items.length) return null;

  return (
    <div className={`variant-theme-fx variant-theme-fx--${motionType}`} aria-hidden="true">
      {items.map((item) => (
        <span
          key={item.id}
          className="variant-theme-fx__particle"
          style={{
            left: item.left,
            animationDelay: item.delay,
            animationDuration: item.duration,
            width: item.size,
            height: item.size,
          }}
        />
      ))}
    </div>
  );
}
