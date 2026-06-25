import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playInteractiveSound } from "../interactiveSounds";
import {
  computeWheelTargetRotation,
  describeWheelSlice,
  formatWheelPoints,
  getSegmentPoints,
  getValidWheelSegments,
  getWheelLabelBoxWidth,
  getWheelLabelLayout,
  normalizeWheelSettings,
  pickWheelSegment,
  polarToCartesian,
  shuffleWheelSegments,
  wheelCanSpin,
  wheelCanSpinAgain,
} from "../wheelUtils";
import "../styles/interactive-wheel.css";

function WheelResultPanel({
  segment,
  appearance,
  soundEnabled = true,
  variant = "modal",
  canSpinAgain,
  onClose,
  onSpinAgain,
  onVerdict,
}) {
  const [verdict, setVerdict] = useState(null);
  const points = getSegmentPoints(segment);

  useEffect(() => {
    setVerdict(null);
  }, [segment?.id, segment?.title]);

  const submitVerdict = (correct) => {
    setVerdict(correct);
    onVerdict?.({
      correct,
      points_awarded: correct ? points : 0,
      points_possible: points,
    });
    if (soundEnabled !== false && appearance) {
      playInteractiveSound(appearance, correct ? "correct" : "wrong");
    }
  };

  const labelClass = variant === "modal" ? "ix-wheel-modal__label" : "ix-wheel-result-inline__label";
  const titleClass = variant === "modal" ? "ix-wheel-modal__title" : "ix-wheel-result-inline__title";
  const textClass = variant === "modal" ? "ix-wheel-modal__text" : "ix-wheel-result-inline__text";

  const content = (
    <>
      <p className={labelClass}>{variant === "modal" ? "Выпало" : "Результат"}</p>
      <h3 className={titleClass}>
        {segment.title}
      </h3>
      {segment.description ? (
        <p className={textClass}>
          {segment.description}
        </p>
      ) : null}

      {verdict === null ? (
        <div className="ix-wheel-verdict">
          <p className="ix-wheel-verdict__question">Ответ верный?</p>
          <div className="ix-wheel-verdict__actions">
            <button
              type="button"
              className="cb-btn cb-btn--primary cb-btn--pill ix-wheel-verdict__btn"
              onClick={() => submitVerdict(true)}
            >
              Да
            </button>
            <button
              type="button"
              className="cb-btn cb-btn--outline ix-wheel-verdict__btn"
              onClick={() => submitVerdict(false)}
            >
              Нет
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className={`ix-wheel-modal__points${verdict ? "" : " ix-wheel-modal__points--muted"}`}>
            {verdict ? `+${formatWheelPoints(points)}` : "Баллы не начислены"}
          </p>
          <div className="ix-wheel-modal__actions">
            {canSpinAgain ? (
              <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={onSpinAgain}>
                Крутить ещё
              </button>
            ) : null}
            <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>
              {variant === "modal" ? "Закрыть" : "Продолжить"}
            </button>
          </div>
        </>
      )}
    </>
  );

  if (variant === "modal") {
    return (
      <div className="ix-wheel-modal" role="dialog" aria-modal="true">
        <div className="ix-wheel-modal__backdrop" onClick={onClose} aria-hidden="true" />
        <div className="ix-wheel-modal__card">{content}</div>
      </div>
    );
  }

  return <div className="ix-wheel-result-inline">{content}</div>;
}

const WHEEL_VIEW_SIZE = 400;

function WheelSegmentLabel({ cx, cy, radius, mid, title, segmentCount, compact }) {
  const layout = getWheelLabelLayout(segmentCount, compact);
  const boxWidth = getWheelLabelBoxWidth(radius, segmentCount);
  const lineHeight = layout.fontSize + 2;
  const boxHeight = layout.maxLines * lineHeight + 4;
  const pos = polarToCartesian(cx, cy, radius * 0.58, mid);

  return (
    <g transform={`rotate(${mid}, ${pos.x}, ${pos.y})`}>
      <foreignObject
        x={pos.x - boxWidth / 2}
        y={pos.y - boxHeight / 2}
        width={boxWidth}
        height={boxHeight}
      >
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          className="ix-wheel-slice-label"
          style={{
            width: `${boxWidth}px`,
            height: `${boxHeight}px`,
            fontSize: `${layout.fontSize}px`,
            lineHeight: `${lineHeight}px`,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: layout.maxLines,
          }}
        >
          {title?.trim() || "—"}
        </div>
      </foreignObject>
    </g>
  );
}

export default function WheelVisual({
  interactive,
  appearance,
  segments: segmentsProp,
  settings: settingsProp,
  compact = false,
  preview = false,
  onSpinResult,
}) {
  const settings = useMemo(
    () => normalizeWheelSettings(settingsProp || interactive?.wheelSettings),
    [settingsProp, interactive?.wheelSettings],
  );
  const allSegments = useMemo(
    () => getValidWheelSegments({ segments: segmentsProp || interactive?.segments || [] }),
    [segmentsProp, interactive?.segments],
  );

  const [pool, setPool] = useState(allSegments);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [usedIds, setUsedIds] = useState([]);
  const spinTimeoutRef = useRef(null);

  useEffect(() => {
    const nextPool = settings.shuffle_segments
      ? shuffleWheelSegments(allSegments)
      : allSegments;
    setPool(nextPool);
    setUsedIds([]);
    setLastResult(null);
    setModalOpen(false);
    setRotation(0);
  }, [allSegments, settings.shuffle_segments]);

  useEffect(() => () => {
    if (spinTimeoutRef.current) window.clearTimeout(spinTimeoutRef.current);
  }, []);

  const canSpin = wheelCanSpin(pool, settings, usedIds, { spinning });
  const canSpinAgain = lastResult
    ? wheelCanSpinAgain(pool, settings, usedIds, lastResult.id)
    : pool.length >= 2;

  const handleVerdict = useCallback((verdict) => {
    if (!lastResult) return;
    onSpinResult?.({
      segment_id: lastResult.id,
      title: lastResult.title,
      at: new Date().toISOString(),
      ...verdict,
    });
  }, [lastResult, onSpinResult]);

  const finishSpin = useCallback((segment, workingPool, workingUsedIds) => {
    setSpinning(false);
    setLastResult(segment);

    let nextPool = workingPool;
    let nextUsedIds = workingUsedIds;

    if (settings.remove_after_spin) {
      nextPool = workingPool.filter((s) => s.id !== segment.id);
      nextUsedIds = [...workingUsedIds, segment.id];
    } else if (settings.allow_repeat === false) {
      nextUsedIds = [...workingUsedIds, segment.id];
    }

    if (settings.shuffle_segments && nextPool.length >= 2) {
      nextPool = shuffleWheelSegments(nextPool);
    }

    setPool(nextPool);
    setUsedIds(nextUsedIds);

    if (settings.show_result_modal !== false) {
      setModalOpen(true);
    }

    if (settings.sound_enabled !== false && appearance) {
      playInteractiveSound(appearance, "end");
    }
  }, [appearance, settings]);

  const handleSpin = useCallback(() => {
    if (!wheelCanSpin(pool, settings, usedIds, { spinning })) return;

    const pick = pickWheelSegment(pool, {
      allowRepeat: settings.allow_repeat !== false,
      usedIds,
    });
    if (!pick) return;

    const { segment, index } = pick;
    const targetRotation = computeWheelTargetRotation({
      segmentIndex: index,
      segmentCount: pool.length,
      currentRotation: rotation,
      extraSpins: 4 + Math.floor(Math.random() * 3),
    });

    if (settings.sound_enabled !== false && appearance) {
      playInteractiveSound(appearance, "next");
    }

    setSpinning(true);
    setRotation(targetRotation);

    const durationMs = settings.spin_duration * 1000;
    if (spinTimeoutRef.current) window.clearTimeout(spinTimeoutRef.current);
    spinTimeoutRef.current = window.setTimeout(() => {
      finishSpin(segment, pool, usedIds);
    }, durationMs);
  }, [
    appearance,
    finishSpin,
    pool,
    rotation,
    settings,
    spinning,
    usedIds,
  ]);

  const viewSize = WHEEL_VIEW_SIZE;
  const cx = viewSize / 2;
  const cy = viewSize / 2;
  const radius = viewSize / 2 - 6;
  const sliceAngle = pool.length ? 360 / pool.length : 0;

  if (pool.length < 2) {
    return (
      <div className={`ix-wheel ix-wheel--empty${compact ? " ix-wheel--compact" : " ix-wheel--full"}`}>
        <div className="ix-wheel__empty">
          <p>{preview ? "Добавьте минимум 2 сектора" : "Недостаточно секторов для запуска"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`ix-wheel${compact ? " ix-wheel--compact" : " ix-wheel--full"}${spinning ? " ix-wheel--spinning" : ""}`}>
      <div className="ix-wheel__pointer" aria-hidden="true" />
      <div
        className="ix-wheel__disc-wrap"
        style={{
          transition: spinning
            ? `transform ${settings.spin_duration}s cubic-bezier(0.2, 0.8, 0.2, 1)`
            : "none",
          transform: `rotate(${rotation}deg)`,
        }}
      >
        <svg
          className="ix-wheel__disc"
          viewBox={`0 0 ${viewSize} ${viewSize}`}
          role="img"
          aria-label="Колесо фортуны"
        >
          {pool.map((segment, index) => {
            const start = index * sliceAngle;
            const end = start + sliceAngle;
            const mid = start + sliceAngle / 2;
            return (
              <g key={segment.id}>
                <path
                  d={describeWheelSlice(cx, cy, radius, start, end)}
                  fill={segment.color || "#2563EB"}
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
                <WheelSegmentLabel
                  cx={cx}
                  cy={cy}
                  radius={radius}
                  mid={mid}
                  title={segment.title}
                  segmentCount={pool.length}
                  compact={compact}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <button
        type="button"
        className="ix-wheel__spin-btn"
        disabled={!canSpin}
        onClick={handleSpin}
      >
        {spinning ? "…" : "Крутить"}
      </button>

      <p className="ix-wheel__meta">{pool.length} секторов</p>

      {lastResult && settings.show_result_modal === false ? (
        <WheelResultPanel
          segment={lastResult}
          appearance={appearance}
          soundEnabled={settings.sound_enabled !== false}
          variant="inline"
          canSpinAgain={canSpinAgain && !spinning}
          onClose={() => setLastResult(null)}
          onSpinAgain={() => {
            if (canSpinAgain && !spinning) handleSpin();
          }}
          onVerdict={handleVerdict}
        />
      ) : null}

      {modalOpen && lastResult ? (
        <WheelResultPanel
          segment={lastResult}
          appearance={appearance}
          soundEnabled={settings.sound_enabled !== false}
          variant="modal"
          canSpinAgain={canSpinAgain && !spinning}
          onClose={() => setModalOpen(false)}
          onSpinAgain={() => {
            setModalOpen(false);
            if (canSpinAgain && !spinning) handleSpin();
          }}
          onVerdict={handleVerdict}
        />
      ) : null}
    </div>
  );
}
