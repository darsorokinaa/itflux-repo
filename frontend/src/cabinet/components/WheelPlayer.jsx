import { useMemo, useRef, useState, useEffect } from "react";
import WheelVisual from "./WheelVisual";
import { getInteractiveDisplayTitle } from "../interactivesData";
import { resolveInteractiveAppearance } from "../interactiveAppearance";
import { formatWheelPoints, getWheelSettings } from "../wheelUtils";
import { usePlaybackBridge } from "../materials/collab/usePlaybackBridge";

export default function WheelPlayer({
  interactive,
  appearance: appearanceProp,
  bare,
  playing,
  onComplete,
  collab = null,
  readOnly = false,
}) {
  const appearance = useMemo(
    () => appearanceProp || resolveInteractiveAppearance(interactive),
    [appearanceProp, interactive],
  );
  const settings = getWheelSettings(interactive);
  const [results, setResults] = useState([]);
  const [finished, setFinished] = useState(false);
  const resultsRef = useRef([]);
  const { emit, shouldApplyRemote, consumeSkipEmit } = usePlaybackBridge(collab || {});
  const studyMode = bare || playing;

  useEffect(() => {
    if (!collab?.follow || !shouldApplyRemote(collab.remote)) return;
    const remote = collab.remote;
    if (Array.isArray(remote.results)) {
      resultsRef.current = remote.results;
      setResults(remote.results);
    }
    if (remote.finished != null) setFinished(Boolean(remote.finished));
  }, [collab?.follow, collab?.remote, shouldApplyRemote]);

  useEffect(() => {
    if (consumeSkipEmit()) return;
    emit({
      type: "wheel",
      started: true,
      results,
      finished,
    });
  }, [results, finished, emit, consumeSkipEmit]);

  const handleSpinResult = (payload) => {
    if (readOnly) return;
    const next = [...resultsRef.current, payload];
    resultsRef.current = next;
    setResults(next);
  };

  const handleFinish = () => {
    if (readOnly) return;
    const totalPoints = resultsRef.current.reduce(
      (sum, item) => sum + (item.points_awarded || 0),
      0,
    );
    onComplete?.(100, {
      spins_count: resultsRef.current.length,
      results: resultsRef.current,
      total_points: totalPoints,
      score: totalPoints,
    });
    setFinished(true);
  };

  const restart = () => {
    if (readOnly) return;
    resultsRef.current = [];
    setResults([]);
    setFinished(false);
  };

  if (finished) {
    const totalPoints = results.reduce((sum, item) => sum + (item.points_awarded || 0), 0);
    return (
      <div className="ix-wheel-player-done">
        <p className="ix-wheel-player-done__title">Интерактив завершён</p>
        {results.length ? (
          <ul className="ix-wheel-player-done__list">
            {results.map((r) => (
              <li key={`${r.segment_id}-${r.at}`}>
                {r.title}
                {r.correct ? ` · +${r.points_awarded}` : r.correct === false ? " · 0" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {totalPoints > 0 ? (
          <p className="ix-wheel-player-done__score">Итого: {formatWheelPoints(totalPoints)}</p>
        ) : null}
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={restart}>
          Пройти ещё раз
        </button>
      </div>
    );
  }

  return (
    <div className={`ix-wheel-player${studyMode ? " ix-wheel-player--bare" : ""}`}>
      {(() => {
        const displayTitle = getInteractiveDisplayTitle(interactive, "");
        return studyMode && displayTitle ? (
          <h2 className="ix-wheel-player__title">{displayTitle}</h2>
        ) : null;
      })()}
      <WheelVisual
        interactive={interactive}
        appearance={appearance}
        settings={settings}
        onSpinResult={handleSpinResult}
      />
      {studyMode ? (
        <div className="ix-wheel-player__footer">
          <button
            type="button"
            className="cb-btn cb-btn--outline"
            onClick={handleFinish}
            disabled={readOnly}
          >
            Завершить
          </button>
        </div>
      ) : null}
    </div>
  );
}
