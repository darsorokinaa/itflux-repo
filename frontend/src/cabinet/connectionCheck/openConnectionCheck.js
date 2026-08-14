/** Открыть единый модал проверки связи из карточек урока. */

import { primeConnectionCheckMedia } from "./mediaDevices";

export const CONNECTION_CHECK_OPEN_EVENT = "cabinet:open-connection-check";
export const CONNECTION_CHECK_CLOSE_EVENT = "cabinet:close-connection-check";

export function openConnectionCheck(detail = {}) {
  if (typeof window === "undefined") return;
  void primeConnectionCheckMedia();
  window.dispatchEvent(new CustomEvent(CONNECTION_CHECK_OPEN_EVENT, { detail }));
}

export function closeConnectionCheck() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONNECTION_CHECK_CLOSE_EVENT));
}
