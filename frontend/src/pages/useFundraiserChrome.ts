import { useEffect, useState } from "react";

const PAGE_TITLE = "🎄 Рождественский сбор — Цифровой поток";

export function useFundraiserTitle() {
  useEffect(() => {
    const previous = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);
}

function visibleHeight(node: Element | null): number {
  if (!node) return 0;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  return Math.ceil(node.getBoundingClientRect().height);
}

export function useStickyFundraiserHelp(): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const card = document.getElementById("sbor-card");
    if (!card || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShow(!entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return show;
}

export function useFundraiserDock() {
  useEffect(() => {
    const applyDock = () => {
      const cookie = document.querySelector(".cookie-banner");
      const tab = document.querySelector(".mobile-tabbar");
      const offset = Math.max(visibleHeight(cookie), visibleHeight(tab));
      document.documentElement.style.setProperty("--xmas-dock-bottom", `${offset}px`);
    };
    applyDock();
    const observer = new MutationObserver(applyDock);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("resize", applyDock);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", applyDock);
    };
  }, []);
}

export function useFundraiserHeaderOffset() {
  useEffect(() => {
    const header = document.querySelector(".site-header");
    if (!header) return undefined;
    const apply = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--xmas-stick-top", `${height + 8}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);
}

export function stepLightIndex(index: number | null, delta: number, count: number): number | null {
  if (index == null || count <= 0) return index;
  return (index + delta + count) % count;
}

export function useFundraiserOverlayLock(helpOpen: boolean, lightIndex: number | null, count: number, closeHelp: () => void, setLightIndex: (value: number | null | ((index: number | null) => number | null)) => void) {
  useEffect(() => {
    if (!helpOpen && lightIndex == null) {
      document.body.style.overflow = "";
      return undefined;
    }
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeHelp();
        setLightIndex(null);
        return;
      }
      if (lightIndex == null) return;
      if (event.key === "ArrowRight") setLightIndex((index) => stepLightIndex(index, 1, count));
      if (event.key === "ArrowLeft") setLightIndex((index) => stepLightIndex(index, -1, count));
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [helpOpen, lightIndex, count, closeHelp, setLightIndex]);
}
