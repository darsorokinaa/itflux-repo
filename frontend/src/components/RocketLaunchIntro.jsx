import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { animated, useSpring } from "@react-spring/web";

function useViewport() {
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1200,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

export default function RocketLaunchIntro({ onDone }) {
  const [key, setKey] = useState(0);
  const [done, setDone] = useState(false);
  const viewport = useViewport();

  const orbit = useMemo(() => {
    const { w, h } = viewport;
    const marginX = Math.min(120, Math.max(60, w * 0.11));
    const baselineY = Math.max(100, h - Math.min(160, Math.max(100, h * 0.15)));
    const startX = w - marginX;
    const endX = marginX;
    const radius = (startX - endX) / 2;
    const centerX = (startX + endX) / 2;
    return { radius, centerX, centerY: baselineY };
  }, [viewport]);

  const { t } = useSpring({
    key,
    from: { t: 0 },
    to: { t: 1 },
    config: { duration: 2600, easing: (x) =>
      x < 0.5 ? 2 * x * x : -1 + (4 - 2 * x) * x
    },
    onRest: () => {
      setDone(true);
      onDone?.();
    },
  });

  if (done) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 999,
      }}
      aria-hidden="true"
    >
      {/* Dashed orbit arc */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
      >
        <path
          d={`M ${orbit.centerX - orbit.radius} ${orbit.centerY}
              A ${orbit.radius} ${orbit.radius} 0 0 1
              ${orbit.centerX + orbit.radius} ${orbit.centerY}`}
          fill="none"
          stroke="rgba(100,140,220,0.15)"
          strokeWidth="1.5"
          strokeDasharray="5 7"
        />
      </svg>

      {/* Rocket */}
      <animated.div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          opacity: t.to((v) =>
            v < 0.07 ? v / 0.07 : v > 0.87 ? (1 - v) / 0.13 : 1
          ),
          transform: t.to((v) => {
            const theta = Math.PI * v;
            const x = orbit.centerX + orbit.radius * Math.cos(theta);
            const y = orbit.centerY - orbit.radius * Math.sin(theta);
            const dx = -orbit.radius * Math.sin(theta);
            const dy = -orbit.radius * Math.cos(theta);
            const rot = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
            return `translate(${x - 16}px, ${y - 16}px) rotate(${rot}deg)`;
          }),
        }}
      >
        <span style={{ fontSize: 32, display: "block", lineHeight: 1 }}>🚀</span>

        {/* Flame */}
        <animated.div
          style={{
            position: "absolute",
            left: "50%",
            bottom: -14,
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            opacity: t.to((v) =>
              v < 0.1 ? v / 0.1 : v > 0.78 ? Math.max(0, (1 - v) / 0.22) : 1
            ),
          }}
        >
          {[
            { size: 10, opacity: 1.0 },
            { size: 7,  opacity: 0.7 },
            { size: 4,  opacity: 0.45 },
          ].map(({ size, opacity }, i) => (
            <animated.div
              key={i}
              style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background: `radial-gradient(circle, #ffcc44 0%, #ff7700 60%, transparent 100%)`,
                opacity: t.to((v) => {
                  const fs =
                    v < 0.1 ? v / 0.1 : v > 0.78 ? Math.max(0, (1 - v) / 0.22) : 1;
                  return fs * opacity;
                }),
                transform: t.to((v) => {
                  const fs =
                    v < 0.1 ? v / 0.1 : v > 0.78 ? Math.max(0, (1 - v) / 0.22) : 1;
                  return `scale(${0.5 + fs * 0.7 + Math.sin(v * 40 + i) * 0.15})`;
                }),
              }}
            />
          ))}
        </animated.div>
      </animated.div>
    </div>
  );
}