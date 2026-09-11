/**
 * Официальный Timeweb Cloud AI embed-виджет.
 *
 * Это UI-скрипт, не API. Лимиты платформы через embed перехватить нельзя —
 * бизнес-логика в Cabinet/ai_* остаётся отдельно и этим виджетом не управляется.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const TIMEWEB_AI_EMBED_SRC =
  "https://timeweb.cloud/api/v1/cloud-ai/agents/db74a6df-2c29-42a0-a118-c322c0cb37ad/embed.js?collapsed=true";

const SCRIPT_ID = "timeweb-cloud-ai-embed";

/** Сколько активных layout-эффектов держат виджет. Нужен, чтобы React StrictMode не снимал скрипт и не плодил копии. */
let embedOwners = 0;

function pathAllowsEmbed(pathname) {
  const path = (pathname || "").replace(/\/+$/, "") || "/";
  if (/^\/cabinet\/meetings(\/|$)/.test(path)) return false;
  if (/^\/cabinet\/boards\/[^/]+$/.test(path)) return false;
  if (/^\/teacher\/boards\/[^/]+$/.test(path)) return false;
  if (/^\/cabinet\/interactives\/[^/]+\/play$/.test(path)) return false;
  if (/^\/cabinet\/student\/interactives\/\d+\/play$/.test(path)) return false;
  return true;
}

function removeInjectedScript() {
  document.getElementById(SCRIPT_ID)?.remove();
}

function removeWidgetDom() {
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
      "[class*='timeweb']",
      "[id*='tw-ai']",
      "[class*='tw-ai']",
      "[data-tw-agent]",
      "[data-agent-id='db74a6df-2c29-42a0-a118-c322c0cb37ad']",
    ].join(","),
  ).forEach((node) => {
    if (node.tagName === "SCRIPT" && node.id === SCRIPT_ID) return;
    if (node.id === "root") return;
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
    return () => {
      embedOwners = Math.max(0, embedOwners - 1);
      queueMicrotask(() => {
        if (embedOwners <= 0) removeWidgetDom();
      });
    };
  }, [active]);

  return null;
}
