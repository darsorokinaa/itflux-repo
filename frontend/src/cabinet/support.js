/** Открыть единый SupportModal из любого места кабинета. */
export const SUPPORT_OPEN_EVENT = "cabinet:open-support";

export function openSupport() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SUPPORT_OPEN_EVENT));
}
