import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

const PLAYED_KEY = "seasonal_theme_fx_played_v1";

function alreadyPlayed(themeKey) {
  try {
    return sessionStorage.getItem(PLAYED_KEY) === String(themeKey);
  } catch {
    return false;
  }
}

function markPlayed(themeKey) {
  try {
    sessionStorage.setItem(PLAYED_KEY, String(themeKey));
  } catch {
    /* private mode */
  }
}

/**
 * Одноразовый эффект за сессию браузера (не при каждой смене вкладки).
 * Картинка: theme.animation.image_url, иначе встроенный рисунок.
 */
export default function SeasonalThemeEffects({ theme, intensity, isMobile }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const [canvasEl, setCanvasEl] = useState(null);
  const themeKey = theme?.id || theme?.slug || "theme";
  const [skipped] = useState(() => alreadyPlayed(themeKey));
  const [finished, setFinished] = useState(false);
  const setCanvasRef = useCallback((node) => {
    canvasRef.current = node;
    setCanvasEl(node);
  }, []);

  const animType = theme?.animation?.type || "none";
  const spriteUrl = theme?.animation?.image_url || null;
  const builtInMotion = ["snow", "leaves", "confetti"].includes(animType);
  const motionType = builtInMotion
    ? animType
    : spriteUrl && animType !== "none" && animType !== "off"
      ? "leaves"
      : null;
  const needsCanvas = Boolean(motionType) && !skipped && !finished;

  const maxElements = Math.min(
    Number(theme?.animation?.max_elements) || 20,
    intensity === "festive" ? 40 : intensity === "normal" ? 28 : 16,
  );
  const fpsLimit = Math.min(Number(theme?.animation?.fps_limit) || 24, isMobile ? 18 : 30);

  useEffect(() => {
    const root = document.documentElement;
    if (!needsCanvas) {
      root.removeAttribute("data-seasonal-anim");
      root.removeAttribute("data-seasonal-intensity");
      return undefined;
    }
    root.setAttribute("data-seasonal-anim", animType);
    root.setAttribute("data-seasonal-intensity", intensity || "minimal");
    return () => {
      root.removeAttribute("data-seasonal-anim");
      root.removeAttribute("data-seasonal-intensity");
    };
  }, [animType, intensity, needsCanvas]);

  useEffect(() => {
    if (!needsCanvas || !motionType) return undefined;

    const canvas = canvasEl;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return undefined;

    let width = 0;
    let height = 0;
    let particles = [];
    let last = 0;
    let cancelled = false;
    let sprite = null;
    const startedAt = performance.now();
    const MAX_MS = 6500;
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

    const leafColors = ["#B45309", "#CA8A04", "#D97706", "#92400E", "#A16207", "#EAB308"];

    const spawn = (kind) => {
      const count = kind === "confetti" ? Math.min(maxElements, 36) : maxElements;
      particles = Array.from({ length: count }, (_, i) => {
        const size = sprite
          ? (kind === "snow" ? 18 : 22) + Math.random() * (kind === "snow" ? 14 : 18)
          : kind === "snow"
            ? 2.5 + Math.random() * 3.5
            : kind === "leaves"
              ? 8 + Math.random() * 10
              : 3 + Math.random() * 4;
        const delay = (i / count) * 0.9;
        return {
          x: Math.random() * width,
          y: kind === "confetti"
            ? Math.random() * height * 0.25 - 20
            : -30 - Math.random() * height * 0.35 - delay * 80,
          r: size,
          vx: (Math.random() - 0.5) * (kind === "confetti" ? 2.4 : kind === "leaves" ? 1.1 : 0.7),
          vy:
            kind === "confetti"
              ? 1.8 + Math.random() * 2.8
              : kind === "leaves"
                ? 1.0 + Math.random() * 1.8
                : 0.7 + Math.random() * 1.4,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * (kind === "leaves" ? 0.08 : 0.05),
          color:
            kind === "confetti"
              ? ["#E11D48", "#2563EB", "#16A34A", "#F59E0B", "#7C3AED"][Math.floor(Math.random() * 5)]
              : kind === "leaves"
                ? leafColors[Math.floor(Math.random() * leafColors.length)]
                : "rgba(255,255,255,0.9)",
          alive: true,
        };
      });
    };

    const drawLeaf = (p) => {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-p.r * 0.7, 0);
      ctx.lineTo(p.r * 0.7, 0);
      ctx.stroke();
    };

    const drawParticle = (p) => {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (sprite && sprite.complete && sprite.naturalWidth > 0) {
        const w = p.r;
        const h = (sprite.naturalHeight / sprite.naturalWidth) * w;
        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      } else if (motionType === "leaves") {
        ctx.fillStyle = p.color;
        drawLeaf(p);
      } else if (motionType === "confetti") {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r, -p.r / 2, p.r * 1.6, p.r);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const finish = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, width, height);
      markPlayed(themeKey);
      setFinished(true);
    };

    const tick = (ts) => {
      if (cancelled) return;
      if (ts - last < frameInterval) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      last = ts;
      ctx.clearRect(0, 0, width, height);

      if (ts - startedAt > MAX_MS) {
        finish();
        return;
      }

      let alive = 0;
      for (const p of particles) {
        if (!p.alive) continue;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (motionType === "leaves") {
          p.x += Math.sin(p.y * 0.02 + p.rot) * 0.35;
        }
        if (p.y > height + 48) {
          p.alive = false;
          continue;
        }
        alive += 1;
        drawParticle(p);
      }

      if (alive === 0) {
        finish();
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    const start = () => {
      if (cancelled) return;
      // Помечаем сразу, чтобы при размонтировании/смене вкладки не запустилось снова
      markPlayed(themeKey);
      resize();
      spawn(motionType);
      window.addEventListener("resize", resize);
      rafRef.current = requestAnimationFrame(tick);
    };

    if (spriteUrl) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        sprite = img;
        start();
      };
      img.onerror = () => {
        if (cancelled) return;
        sprite = null;
        start();
      };
      img.src = spriteUrl;
    } else {
      start();
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [motionType, maxElements, fpsLimit, needsCanvas, canvasEl, spriteUrl, themeKey]);

  if (!needsCanvas || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <canvas
      ref={setCanvasRef}
      className="seasonal-fx-canvas"
      aria-hidden="true"
    />,
    document.body,
  );
}
