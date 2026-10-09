import { useEffect, useMemo, useState } from "react";
import { animationById } from "./decorations";

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function ThemeEffects({ type }) {
  const [reduced, setReduced] = useState(() => (typeof window === "undefined" ? false : prefersReducedMotion()));
  const [narrow, setNarrow] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < 900));
  const animation = animationById(type);
  const particles = animation?.particles;

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
    if (!particles || reduced) return [];
    const count = narrow ? particles.narrow : particles.wide;
    const total = Math.max(0, Number(count) || 0);
    return Array.from({ length: total }, (_, index) => ({
      id: `${animation.id}-${index}`,
      left: `${(index * 83) % 100}%`,
      delay: `${(index % 7) * 0.7}s`,
      duration: `${10 + (index % 6) * 2}s`,
      size: `${10 + (index % 5) * 4}px`,
    }));
  }, [animation?.id, narrow, particles, reduced]);

  if (reduced || !animation || animation.id === "none" || !items.length) return null;

  return (
    <div className={`variant-theme-fx variant-theme-fx--${animation.id}`} aria-hidden="true">
      {items.map((item) => (
        <span
          key={item.id}
          className={`variant-theme-fx__particle variant-theme-fx__particle--${particles.shape || "dot"}`}
          style={{
            left: item.left,
            animationDelay: item.delay,
            animationDuration: item.duration,
            width: item.size,
            height: item.size,
            background: particles.color,
          }}
        />
      ))}
    </div>
  );
}
