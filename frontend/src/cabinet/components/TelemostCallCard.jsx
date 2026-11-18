import { useEffect, useState } from "react";

import TelemostLaunch from "./TelemostLaunch";
import {
  IFRAME_NOTE,
  INVALID_LINK_MESSAGE,
  POPUP_BLOCKED_MESSAGE,
  fetchTelemostJoin,
  fetchTelemostStatus,
  navigateTelemostCallWindow,
  reserveTelemostCallWindow,
} from "../telemostBackup";
import {
  getTelemostBackupState,
  setTelemostBackupState,
  subscribeTelemostBackup,
} from "../telemostBackupSession";

const POLL_MS = 8000;

function useTelemostBackupPoll(meetingUuid) {
  const [state, setState] = useState(getTelemostBackupState);

  useEffect(() => subscribeTelemostBackup(setState), []);

  useEffect(() => {
    if (!meetingUuid) return undefined;
    let cancelled = false;
    const tick = () => {
      fetchTelemostStatus(meetingUuid)
        .then((data) => {
          if (cancelled) return;
          setTelemostBackupState({
            meetingUuid,
            available: Boolean(data?.available),
            open: Boolean(data?.open),
            canCreate: Boolean(data?.canCreate),
          });
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [meetingUuid]);

  return state;
}

async function openTelemostFromCard(uuid, popup, setError) {
  if (!popup) {
    setError(POPUP_BLOCKED_MESSAGE);
    return;
  }
  try {
    const payload = await fetchTelemostJoin(uuid);
    if (!navigateTelemostCallWindow(popup, payload?.url)) {
      setError(INVALID_LINK_MESSAGE);
    }
  } catch (err) {
    try { popup.close(); } catch { /* ignore */ }
    setError(err?.message || INVALID_LINK_MESSAGE);
  }
}

export default function TelemostCallCard({ meetingUuid = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useTelemostBackupPoll(meetingUuid);
  const uuid = meetingUuid || state.meetingUuid;
  const showCreate = Boolean(uuid && state.available && !state.open && state.canCreate);
  const showOpen = Boolean(uuid && state.available && state.open);
  if (!showCreate && !showOpen) return null;

  const onOpen = () => {
    setError("");
    setBusy(true);
    const popup = reserveTelemostCallWindow();
    openTelemostFromCard(uuid, popup, setError).finally(() => setBusy(false));
  };

  return (
    <aside className="telemost-call-card" data-testid="telemost-call-card" aria-live="polite">
      <p className="telemost-call-card__title">
        {showOpen ? "Идёт запасной звонок в Телемосте" : "Запасной звонок: Телемост"}
      </p>
      {showOpen ? (
        <button
          type="button"
          className="telemost-call-card__open"
          onClick={onOpen}
          disabled={busy}
        >
          {busy ? "Открываем…" : "Открыть звонок в Телемосте"}
        </button>
      ) : (
        <TelemostLaunch available canCreate meetingUuid={uuid} />
      )}
      <p className="telemost-call-card__note">{IFRAME_NOTE}</p>
      {error ? <p className="telemost-call-card__error" role="alert">{error}</p> : null}
    </aside>
  );
}
