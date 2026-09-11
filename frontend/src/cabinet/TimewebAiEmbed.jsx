/**
 * Официальный Timeweb Cloud AI embed-виджет.
 *
 * Это UI-скрипт, не API. Лимиты платформы через embed перехватить нельзя —
 * бизнес-логика в Cabinet/ai_* остаётся отдельно и этим виджетом не управляется.
 *
 * Чат доступен с тарифа «Профи» и выше (Профи, Премиум, Школа).
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import "./timeweb-ai-embed.css";

export const TIMEWEB_AI_EMBED_SRC =
  "https://timeweb.cloud/api/v1/cloud-ai/agents/db74a6df-2c29-42a0-a118-c322c0cb37ad/embed.js?collapsed=true";

const SCRIPT_ID = "timeweb-cloud-ai-embed";
const HTML_CLASS = "cb-ai-embed-on";
const LAUNCHER_CLASS = "cb-ai-embed-launcher";
const PRO_PLAN_RANK = 2;
const PRO_PLUS_SLUGS = new Set(["pro", "profi", "premium", "school"]);

/** Сколько активных layout-эффектов держат виджет. Нужен, чтобы React StrictMode не снимал скрипт и не плодил копии. */
let embedOwners = 0;
let offsetObserver = null;
let offsetTimer = 0;

export function planHasTimewebAi(plan) {
  if (!plan) return false;
  const slug = String(plan.slug || "").toLowerCase();
  if (PRO_PLUS_SLUGS.has(slug)) return true;
  const rank = Number(plan.content_access_rank);
  return Number.isFinite(rank) && rank >= PRO_PLAN_RANK;
}

function pathAllowsEmbed(pathname) {
  const path = (pathname || "").replace(/\/+$/, "") || "/";
  if (/^\/cabinet\/meetings(\/|$)/.test(path)) return false;
  if (/^\/cabinet\/boards\/[^/]+$/.test(path)) return false;
  if (/^\/teacher\/boards\/[^/]+$/.test(path)) return false;
  if (/^\/cabinet\/interactives\/[^/]+\/play$/.test(path)) return false;
  if (/^\/cabinet\/student\/interactives\/\d+\/play$/.test(path)) return false;
  return true;
}

function isAppChrome(el) {
  if (!el || el.nodeType !== 1) return true;
  if (el === document.documentElement || el === document.body) return true;
  if (el.id === "root" || el.id === SCRIPT_ID) return true;
  if (el.classList?.contains(HTML_CLASS) || el.classList?.contains(LAUNCHER_CLASS)) {
    if (el === document.documentElement) return true;
  }
  if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") return true;
  return Boolean(
    el.closest?.(".seasonal-appearance-fab-dock")
    || el.closest?.(".support-fab")
    || el.closest?.(".cb-sch-fab")
    || el.closest?.(".cb-mobile-nav")
    || el.closest?.(".cb-teacher-mobile-nav"),
  );
}

function mentionsTimeweb(el) {
  const blob = [
    el.id,
    el.className,
    el.getAttribute?.("src"),
    el.getAttribute?.("data-src"),
    el.getAttribute?.("data-tw-agent"),
    el.getAttribute?.("data-agent-id"),
  ].join(" ");
  return /timeweb|cloud-ai|tw-ai|twc-/i.test(blob);
}

function isBottomRightFixed(el) {
  const style = window.getComputedStyle(el);
  if (style.position !== "fixed" && style.position !== "sticky") return false;
  const right = parseFloat(style.right);
  const bottom = parseFloat(style.bottom);
  if (!Number.isFinite(right) || right > 48) return false;
  if (!Number.isFinite(bottom) || bottom > 120) return false;
  const box = el.getBoundingClientRect();
  return box.width >= 36 && box.width <= 96 && box.height >= 36 && box.height <= 96;
}

function applyLauncherOffset(el) {
  el.classList.add(LAUNCHER_CLASS);
  el.dataset.itfluxAiLauncher = "1";
  const rootStyle = getComputedStyle(document.documentElement);
  const right = rootStyle.getPropertyValue("--cb-ai-embed-right").trim();
  const bottom = rootStyle.getPropertyValue("--cb-ai-embed-bottom").trim();
  if (right) el.style.setProperty("right", right, "important");
  if (bottom) el.style.setProperty("bottom", bottom, "important");
  el.style.setProperty("left", "auto", "important");
}

function shouldOffset(el) {
  if (isAppChrome(el)) return false;
  if (mentionsTimeweb(el)) return true;
  if (el.dataset?.itfluxAiLauncher === "1") return true;
  if (el.parentElement === document.body && isBottomRightFixed(el)) return true;
  return false;
}

function offsetTimewebLaunchers() {
  if (typeof document === "undefined") return;
  const nodes = [
    ...document.querySelectorAll(
      "iframe, [id*='timeweb'], [id*='tw-ai'], [class*='tw-ai'], [id*='twc-'], [class*='twc-'], [data-tw-agent], [data-itflux-ai-launcher]",
    ),
    ...document.body.children,
  ];
  const seen = new Set();
  nodes.forEach((el) => {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    seen.add(el);
    if (shouldOffset(el)) applyLauncherOffset(el);
  });
}

function startOffsetWatcher() {
  stopOffsetWatcher();
  document.documentElement.classList.add(HTML_CLASS);
  offsetTimewebLaunchers();
  offsetObserver = new MutationObserver(() => {
    window.clearTimeout(offsetTimer);
    offsetTimer = window.setTimeout(offsetTimewebLaunchers, 50);
  });
  offsetObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", offsetTimewebLaunchers);
}

function stopOffsetWatcher() {
  document.documentElement.classList.remove(HTML_CLASS);
  if (offsetObserver) {
    offsetObserver.disconnect();
    offsetObserver = null;
  }
  window.clearTimeout(offsetTimer);
  window.removeEventListener("resize", offsetTimewebLaunchers);
}

function removeInjectedScript() {
  document.getElementById(SCRIPT_ID)?.remove();
}

function removeWidgetDom() {
  stopOffsetWatcher();
  removeInjectedScript();
  document.querySelectorAll("iframe").forEach((frame) => {
    const src = `${frame.getAttribute("src") || ""} ${frame.getAttribute("data-src") || ""}`;
    if (/timeweb\.cloud|timeweb\.ai|cloud-ai/i.test(src)) {
      frame.remove();
    }
  });
  document.querySelectorAll(
    [
      "[id*='timeweb']",
      "[class*='timeweb']:not(html):not(body)",
      "[id*='tw-ai']",
      "[class*='tw-ai']",
      "[data-tw-agent]",
      "[data-itflux-ai-launcher]",
      "[data-agent-id='db74a6df-2c29-42a0-a118-c322c0cb37ad']",
    ].join(","),
  ).forEach((node) => {
    if (node === document.documentElement || node === document.body) return;
    if (node.tagName === "SCRIPT" && node.id === SCRIPT_ID) return;
    if (node.id === "root") return;
    if (node.classList?.contains(HTML_CLASS) || node.classList?.contains(LAUNCHER_CLASS)) {
      if (node === document.documentElement) return;
    }
    node.remove();
  });
}

function ensureEmbedScript() {
  if (document.getElementById(SCRIPT_ID)) return;
  const existing = document.querySelector(`script[src="${TIMEWEB_AI_EMBED_SRC}"]`);
  if (existing) {
    existing.id = SCRIPT_ID;
    return;
  }
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = TIMEWEB_AI_EMBED_SRC;
  document.body.appendChild(script);
}

/**
 * Подключает embed один раз на layout кабинета учителя.
 * Не вставлять <script> в JSX и не вызывать при каждом render.
 */
export default function TimewebAiEmbed({ enabled }) {
  const { pathname } = useLocation();
  const active = Boolean(enabled) && pathAllowsEmbed(pathname);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!active) {
      if (embedOwners <= 0) removeWidgetDom();
      return undefined;
    }
    embedOwners += 1;
    ensureEmbedScript();
    startOffsetWatcher();
    return () => {
      embedOwners = Math.max(0, embedOwners - 1);
      queueMicrotask(() => {
        if (embedOwners <= 0) removeWidgetDom();
      });
    };
  }, [active]);

  return null;
}
