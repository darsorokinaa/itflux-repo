import { useState } from "react";

import {
  INVALID_LINK_MESSAGE,
  POPUP_BLOCKED_MESSAGE,
  navigateTelemostCallWindow,
  reserveTelemostCallWindow,
  fetchTelemostJoin,
} from "../telemostBackup";
import { setTelemostBackupState } from "../telemostBackupSession";

export default function TelemostLaunch({ available = false, meetingUuid = "", canCreate = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!available || !canCreate || !meetingUuid) return null;

  const onClick = async () => {
    setError("");
    const popup = reserveTelemostCallWindow();
    if (!popup) {
      setError(POPUP_BLOCKED_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const payload = await fetchTelemostJoin(meetingUuid);
      const url = payload?.url;
      if (!navigateTelemostCallWindow(popup, url)) {
        setError(INVALID_LINK_MESSAGE);
        return;
      }
      setTelemostBackupState({
        meetingUuid,
        available: true,
        open: true,
        canCreate: true,
      });
    } catch (err) {
      try { popup.close(); } catch { /* ignore */ }
      setError(err?.message || INVALID_LINK_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="video-lesson-telemost">
      <button
        type="button"
        className="video-lesson-btn video-lesson-btn--ghost"
        onClick={() => { void onClick(); }}
        disabled={busy}
      >
        {busy ? "Открываем Телемост…" : "Запасной звонок: Телемост"}
      </button>
      {error ? <p className="video-lesson-telemost__error" role="alert">{error}</p> : null}
    </div>
  );
}
