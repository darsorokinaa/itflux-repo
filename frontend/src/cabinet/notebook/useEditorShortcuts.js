import { useEffect } from "react";

export function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest?.("textarea, input, select, [contenteditable='true'], [contenteditable='']")) return true;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
}

export function modSymbol() {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

export function hasMod(event) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

export function shortcutLabel(keys, { mac = isMacPlatform() } = {}) {
  return keys
    .replaceAll("Mod", mac ? "⌘" : "Ctrl")
    .replaceAll("Shift", mac ? "⇧" : "Shift")
    .replaceAll("Alt", mac ? "⌥" : "Alt");
}

export function useEditorShortcuts(handler, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => handler(event, "down");
    const onKeyUp = (event) => handler(event, "up");
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [handler, enabled]);
}
