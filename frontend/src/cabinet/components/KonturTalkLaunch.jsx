import { useState } from "react";

import { fetchKonturTalkJoin } from "../../utils/cabinetAuth";
import {
  KONTUR_TALK_PROVIDER,
  POPUP_BLOCKED_MESSAGE,
  closeReservedTab,
  isKonturMeetingUrl,
  navigateReservedTab,
  reserveMeetingTab,
} from "../konturTalk";

export default function KonturTalkLaunch({ available = false, meetingUuid = "" }) {
  const [selected, setSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!available || !meetingUuid) return null;

  async function openMeeting() {
    setError("");
    const popup = reserveMeetingTab();
    if (!popup) {
      setError(POPUP_BLOCKED_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const data = await fetchKonturTalkJoin(meetingUuid);
      const url = data?.provider === KONTUR_TALK_PROVIDER && isKonturMeetingUrl(data?.url)
        ? data.url
        : "";
      if (!navigateReservedTab(popup, url)) {
        closeReservedTab(popup);
        setError("Не удалось получить ссылку на видеовстречу.");
        return;
      }
    } catch (err) {
      closeReservedTab(popup);
      setError(err?.message || "Не удалось открыть видеовстречу.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="video-lesson-kontur" data-testid="kontur-talk-launch">
      <button
        type="button"
        className={`video-lesson-btn video-lesson-btn--ghost${selected ? " is-active" : ""}`}
        aria-pressed={selected}
        onClick={() => {
          setSelected((value) => !value);
          setError("");
        }}
      >
        Контур.Толк
      </button>
      {selected ? (
        <button
          type="button"
          className="video-lesson-btn video-lesson-btn--primary"
          disabled={busy}
          onClick={() => { void openMeeting(); }}
        >
          {busy ? "Открываем…" : "Открыть видеовстречу"}
        </button>
      ) : null}
      {error ? (
        <p className="video-lesson-kontur__error" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
