const MODULE_LOAD_ERROR_RE = new RegExp(
  [
    "ChunkLoadError",
    "Loading chunk [\\d]+ failed",
    "Failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "Unexpected token '<'",
    "Importing a module script failed",
    "Unable to preload",
  ].join("|"),
  "i",
);

/** WebKit: "Importing a module script failed." and "Unable to preload…" often have no URL. */
export function matchesModuleLoadError(text) {
  return MODULE_LOAD_ERROR_RE.test(String(text || ""));
}

/** Safari names a failed dynamic import TypeError: Load failed, with no URL. */
export function isModuleLoadError(error) {
  const message = String(error?.message || error || "");
  if (matchesModuleLoadError(message)) return true;
  return error?.name === "TypeError" && message === "Load failed";
}

/** React.lazy throws "x._result.default" when the namespace arrived without a default export. */
export function isStaleBoardModuleError(error) {
  if (isModuleLoadError(error)) return true;
  return String(error?.message || error || "").includes("_result.default");
}
