import { useEffect, useState } from "react";

import { fetchTelemostJoin } from "../../utils/cabinetAuth";
import {
  IFRAME_NOTE,
  INVALID_LINK_MESSAGE,
  POPUP_BLOCKED_MESSAGE,
  navigateTelemostCallWindow,
  reserveTelemostCallWindow,
} from "../telemostBackup";
import { getTelemostBackupState, subscribeTelemostBackup } from "../telemostBackupSession";

export default function TelemostCallCard() {
  const [state, setState] = useState(getTelemostBackupState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeTelemostBackup(setState), []);

  if (!state.available || !state.open || !state.meetingUuid) return null;

  const onOpen = async () => {
    setError("");
    const popup = reserveTelemostCallWindow();
    if (!popup) {
      setError(POPUP_BLOCKED_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const payload = await fetchTelemostJoin(state.meetingUuid);
      const url = payload?.url;
      if (!navigateTelemostCallWindow(popup, url)) {
        setError(INVALID_LINK_MESSAGE);
      }
    } catch (err) {
      try { popup.close(); } catch { /* ignore */ }
      setError(err?.message || INVALID_LINK_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="telemost-call-card" data-testid="telemost-call-card" aria-live="polite">
      <p className="telemost-call-card__title">Идёт запасной звонок в Телемосте</p>
      <button
        type="button"
        className="telemost-call-card__open"
        onClick={() => { void onOpen(); }}
        disabled={busy}
      >
        {busy ? "Открываем…" : "Открыть звонок в Телемосте"}
      </button>
      <p className="telemost-call-card__note">{IFRAME_NOTE}</p>
      {error ? <p className="telemost-call-card__error" role="alert">{error}</p> : null}
    </aside>
  );
}
