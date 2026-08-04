import { useEffect, useRef } from "react";

/**
 * Лёгкие CSS/canvas эффекты сезонной темы.
 * Canvas только для snow/leaves/confetti; остальное — CSS-классы на html.
 */
export default function SeasonalThemeEffects({ theme, intensity, isMobile }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const animType = theme?.animation?.type || "none";
  const maxElements = Math.min(
    Number(theme?.animation?.max_elements) || 20,
    intensity === "festive" ? 40 : intensity === "normal" ? 24 : 12,
  );
  const fpsLimit = Math.min(Number(theme?.animation?.fps_limit) || 24, isMobile ? 18 : 30);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-seasonal-anim", animType);
    root.setAttribute("data-seasonal-intensity", intensity);
    return () => {
      root.removeAttribute("data-seasonal-anim");
      root.removeAttribute("data-seasonal-intensity");
    };
  }, [animType, intensity]);

  useEffect(() => {
    const needsCanvas = ["snow", "leaves", "confetti"].includes(animType);
    if (!needsCanvas) return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return undefined;

    let width = 0;
    let height = 0;
    let particles = [];
    let last = 0;
    let confettiDone = false;
    const frameInterval = 1000 / Math.max(8, fpsLimit);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (kind) => {
      const count = kind === "confetti" ? Math.min(maxElements, 28) : maxElements;
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: kind === "confetti" ? Math.random() * height * 0.3 : Math.random() * -height,
        r: kind === "snow" ? 1.2 + Math.random() * 2.2 : 2 + Math.random() * 3,
        vx: (Math.random() - 0.5) * (kind === "confetti" ? 2.2 : 0.6),
        vy: kind === "confetti" ? 1.5 + Math.random() * 2.5 : 0.4 + Math.random() * 1.2,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.05,
        color:
          kind === "confetti"
            ? ["#E11D48", "#2563EB", "#16A34A", "#F59E0B", "#7C3AED"][Math.floor(Math.random() * 5)]
            : kind === "leaves"
              ? ["#B45309", "#CA8A04", "#D97706", "#92400E"][Math.floor(Math.random() * 4)]
              : "rgba(255,255,255,0.85)",
      }));
    };

    resize();
    spawn(animType);
    window.addEventListener("resize", resize);

    const tick = (ts) => {
      if (ts - last < frameInterval) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      last = ts;
      ctx.clearRect(0, 0, width, height);

      if (animType === "confetti" && confettiDone) {
        return;
      }

      let alive = 0;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (animType === "snow" || animType === "leaves") {
          if (p.y > height + 10) {
            p.y = -10;
            p.x = Math.random() * width;
          }
          alive += 1;
        } else if (animType === "confetti") {
          if (p.y < height + 20) alive += 1;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (animType === "leaves") {
          ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        } else if (animType === "confetti") {
          ctx.fillRect(-p.r, -p.r / 2, p.r * 1.6, p.r);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (animType === "confetti" && alive === 0) {
        confettiDone = true;
        ctx.clearRect(0, 0, width, height);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, width, height);
    };
  }, [animType, maxElements, fpsLimit]);

  if (!["snow", "leaves", "confetti"].includes(animType)) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="seasonal-fx-canvas"
      aria-hidden="true"
    />
  );
}
