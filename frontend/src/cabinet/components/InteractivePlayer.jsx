import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SequenceOrderList from "./SequenceOrderList";
import QuizPlayer from "./QuizPlayer";
import WheelPlayer from "./WheelPlayer";
import {
  resolveInteractiveAppearance,
} from "../interactiveAppearance";
import { getInteractiveDisplayTitle } from "../interactivesData";
import { playInteractiveSound, unlockInteractiveAudio, startInteractiveBackgroundSound, stopInteractiveBackgroundSound } from "../interactiveSounds";

function CompletionScreen({ scorePercent, onRestart }) {
  return (
    <div className="ix-play-complete">
      <p className="ix-play-complete__score">{scorePercent}%</p>
      <p className="ix-play-complete__label">Результат</p>
      <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={onRestart}>
        Пройти снова
      </button>
    </div>
  );
}

function FlashcardConsolidationPrompt({ count, onStart, onSkip }) {
  return (
    <div className="ix-flash-consolidate-prompt">
      <p className="ix-flash-consolidate-prompt__label">Основной проход завершён</p>
      <h3 className="ix-flash-consolidate-prompt__title">Закрепим материал?</h3>
      <p className="ix-flash-consolidate-prompt__text">
        {count === 1
          ? "1 карточка отмечена для повторения"
          : `${count} карточек отмечены для повторения`}
      </p>
      <div className="ix-flash-consolidate-prompt__actions">
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={onStart}>
          Да, повторим
        </button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={onSkip}>
          Пропустить
        </button>
      </div>
    </div>
  );
}

function FlashcardPlayer({ cards, bare, playing, appearance, onComplete }) {
  const list = useMemo(
    () => cards.filter((c) => c.front || c.back),
    [cards],
  );
  const [phase, setPhase] = useState("main");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownIndices, setKnownIndices] = useState(() => new Set());
  const [repeatIndices, setRepeatIndices] = useState(() => new Set());
  const studyMode = bare || playing;

  const consolidateQueue = useMemo(
    () => [...repeatIndices].sort((a, b) => a - b),
    [repeatIndices],
  );

  const activeOriginalIndex = phase === "consolidate"
    ? consolidateQueue[index]
    : index;

  const card = list[activeOriginalIndex] || { front: "", back: "" };
  const activeLength = phase === "consolidate" ? consolidateQueue.length : list.length;

  const resetAll = () => {
    setPhase("main");
    setIndex(0);
    setFlipped(false);
    setKnownIndices(new Set());
    setRepeatIndices(new Set());
  };

  const finishSession = useCallback((knownSet) => {
    playInteractiveSound(appearance, "end");
    const score = list.length > 0
      ? Math.round((knownSet.size / list.length) * 100)
      : 0;
    setPhase("done");
    onComplete?.(score);
  }, [appearance, list.length, onComplete]);

  useEffect(() => {
    const onKey = (e) => {
      if (phase === "consolidate-prompt" || phase === "done") return;
      if (e.key === "ArrowLeft" && index > 0) {
        setIndex((i) => i - 1);
        setFlipped(false);
      }
      if (e.key === "ArrowRight" && index < activeLength - 1) {
        playInteractiveSound(appearance, "next");
        setIndex((i) => i + 1);
        setFlipped(false);
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((v) => {
          if (!v) playInteractiveSound(appearance, "flip");
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, activeLength, appearance, phase]);

  const flipCard = () => {
    setFlipped((v) => {
      if (!v) playInteractiveSound(appearance, "flip");
      return !v;
    });
  };

  const goNext = (markedKnown) => {
    const origIdx = activeOriginalIndex;
    let nextKnown = knownIndices;
    let nextRepeat = repeatIndices;

    if (markedKnown) {
      nextKnown = new Set(knownIndices);
      nextKnown.add(origIdx);
      setKnownIndices(nextKnown);
    } else if (phase === "main") {
      nextRepeat = new Set(repeatIndices);
      nextRepeat.add(origIdx);
      setRepeatIndices(nextRepeat);
    }

    if (index >= activeLength - 1) {
      setFlipped(false);
      if (phase === "main") {
        if (nextRepeat.size > 0) {
          setPhase("consolidate-prompt");
          return;
        }
        finishSession(nextKnown);
        return;
      }
      finishSession(nextKnown);
      return;
    }

    playInteractiveSound(appearance, "next");
    setIndex((i) => i + 1);
    setFlipped(false);
  };

  const startConsolidation = () => {
    setIndex(0);
    setFlipped(false);
    setPhase("consolidate");
  };

  const skipConsolidation = () => {
    finishSession(knownIndices);
  };

  if (list.length === 0) return null;

  if (phase === "consolidate-prompt") {
    return (
      <FlashcardConsolidationPrompt
        count={consolidateQueue.length}
        onStart={startConsolidation}
        onSkip={skipConsolidation}
      />
    );
  }

  if (phase === "done") {
    const score = Math.round((knownIndices.size / list.length) * 100);
    return (
      <CompletionScreen
        scorePercent={score}
        onRestart={resetAll}
      />
    );
  }

  return (
    <div className={`cb-preview-flash${studyMode ? " cb-preview-flash--bare" : ""}`}>
      {studyMode ? (
        <p className="ix-play-progress">
          {phase === "consolidate" ? "Закрепление · " : ""}
          {index + 1} из {activeLength}
        </p>
      ) : null}
      <button
        type="button"
        className={`cb-flash-card${flipped ? " cb-flash-card--flipped" : ""}`}
        onClick={flipCard}
        aria-label="Перевернуть карточку"
      >
        <div className="cb-flash-card__inner">
          <div className="cb-flash-card__face cb-flash-card__face--front">
            {!studyMode ? <span className="cb-flash-card__label">Лицевая сторона</span> : null}
            <p>{card.front || "—"}</p>
            {card.hint ? (
              <small>{studyMode ? card.hint : `Подсказка: ${card.hint}`}</small>
            ) : null}
          </div>
          <div className="cb-flash-card__face cb-flash-card__face--back">
            {!studyMode ? <span className="cb-flash-card__label">Обратная сторона</span> : null}
            <p>{card.back || "—"}</p>
            {card.explanation ? <small>{card.explanation}</small> : null}
          </div>
        </div>
      </button>

      {studyMode && flipped ? (
        <div className="ix-flash-actions">
          <button type="button" className="cb-btn cb-btn--sm ix-flash-btn ix-flash-btn--repeat" onClick={() => goNext(false)}>
            Повторить
          </button>
          <button type="button" className="cb-btn cb-btn--sm ix-flash-btn ix-flash-btn--know" onClick={() => goNext(true)}>
            Знаю
          </button>
        </div>
      ) : null}

      {!studyMode && list.length > 1 ? (
        <div className="cb-preview-nav">
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            disabled={index === 0}
            onClick={() => { setIndex((i) => i - 1); setFlipped(false); }}
          >
            Назад
          </button>
          <span className="cb-preview-nav__count">{index + 1} / {activeLength}</span>
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            disabled={index >= activeLength - 1}
            onClick={() => { playInteractiveSound(appearance, "next"); setIndex((i) => i + 1); setFlipped(false); }}
          >
            Далее
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MatchingPlayer({ pairs, shuffle, bare, playing, appearance, onComplete }) {
  const [selectedLeft, setSelectedLeft] = useState(null);
  const [matched, setMatched] = useState([]);
  const [wrong, setWrong] = useState(null);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState([]);
  const stageRef = useRef(null);
  const leftRefs = useRef({});
  const rightRefs = useRef({});
  const studyMode = bare || playing;

  const leftItems = useMemo(() => {
    const items = pairs.map((p, i) => ({ id: `l${i}`, text: p.left || `— ${i + 1}` }));
    return shuffle ? [...items].sort(() => Math.random() - 0.5) : items;
  }, [pairs, shuffle]);

  const rightItems = useMemo(() => {
    const items = pairs.map((p, i) => ({ id: `r${i}`, text: p.right || `— ${i + 1}`, pairIndex: i }));
    return shuffle ? [...items].sort(() => Math.random() - 0.5) : items;
  }, [pairs, shuffle]);

  const updateLines = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const stageRect = stage.getBoundingClientRect();
    const nextLines = matched.map((pairIndex) => {
      const leftEl = leftRefs.current[`l${pairIndex}`];
      const rightEl = rightRefs.current[`r${pairIndex}`];
      if (!leftEl || !rightEl) return null;

      const leftRect = leftEl.getBoundingClientRect();
      const rightRect = rightEl.getBoundingClientRect();

      return {
        key: pairIndex,
        x1: leftRect.right - stageRect.left,
        y1: leftRect.top + leftRect.height / 2 - stageRect.top,
        x2: rightRect.left - stageRect.left,
        y2: rightRect.top + rightRect.height / 2 - stageRect.top,
      };
    }).filter(Boolean);

    setLines(nextLines);
  }, [matched]);

  useLayoutEffect(() => {
    updateLines();
  }, [updateLines, leftItems, rightItems, selectedLeft, wrong]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const observer = new ResizeObserver(() => updateLines());
    observer.observe(stage);
    window.addEventListener("resize", updateLines);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateLines);
    };
  }, [updateLines]);

  useEffect(() => {
    if (matched.length === pairs.length && pairs.length > 0 && !done) {
      playInteractiveSound(appearance, "end");
      setDone(true);
      onComplete?.(100);
    }
  }, [appearance, matched.length, pairs.length, done, onComplete]);

  const handleLeft = (id) => {
    if (matched.includes(id.replace("l", ""))) return;
    playInteractiveSound(appearance, "tap");
    setSelectedLeft(id);
    setWrong(null);
  };

  const handleRight = (item) => {
    if (!selectedLeft) return;
    const leftIndex = selectedLeft.replace("l", "");
    const rightIndex = String(item.pairIndex);
    if (leftIndex === rightIndex) {
      playInteractiveSound(appearance, "correct");
      setMatched((m) => [...m, leftIndex]);
      setSelectedLeft(null);
    } else {
      playInteractiveSound(appearance, "wrong");
      setWrong(`${selectedLeft}-${item.id}`);
      window.setTimeout(() => setWrong(null), 800);
      setSelectedLeft(null);
    }
  };

  if (pairs.length === 0) return null;

  if (done) {
    return (
      <CompletionScreen
        scorePercent={100}
        onRestart={() => {
          setMatched([]);
          setSelectedLeft(null);
          setDone(false);
          setLines([]);
        }}
      />
    );
  }

  return (
    <div className={`cb-preview-match${studyMode ? " cb-preview-match--bare" : ""}`}>
      <div className="cb-preview-match__stage" ref={stageRef}>
        <svg className="cb-preview-match__lines" aria-hidden="true">
          {lines.map((line) => (
            <line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              className="cb-preview-match__line"
            />
          ))}
        </svg>
        <div className="cb-preview-match__cols">
          <div className="cb-preview-match__col">
            {leftItems.map((item) => (
              <button
                key={item.id}
                type="button"
                ref={(el) => {
                  if (el) leftRefs.current[item.id] = el;
                  else delete leftRefs.current[item.id];
                }}
                className={[
                  "cb-match-item",
                  selectedLeft === item.id ? "cb-match-item--selected" : "",
                  matched.includes(item.id.replace("l", "")) ? "cb-match-item--done" : "",
                  wrong?.startsWith(item.id) ? "cb-match-item--wrong" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => handleLeft(item.id)}
              >
                {item.text}
              </button>
            ))}
          </div>
          <div className="cb-preview-match__col">
            {rightItems.map((item) => (
              <button
                key={item.id}
                type="button"
                ref={(el) => {
                  if (el) rightRefs.current[item.id] = el;
                  else delete rightRefs.current[item.id];
                }}
                className={[
                  "cb-match-item",
                  matched.includes(String(item.pairIndex)) ? "cb-match-item--done" : "",
                  wrong?.endsWith(item.id) ? "cb-match-item--wrong" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => handleRight(item)}
              >
                {item.text}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!studyMode && matched.length === pairs.length ? (
        <p className="cb-preview-success">Все пары собраны верно!</p>
      ) : null}
    </div>
  );
}

function SequencePlayer({ steps, shuffle, bare, playing, appearance, onComplete }) {
  const [order, setOrder] = useState([]);
  const [checked, setChecked] = useState(false);
  const [checkOk, setCheckOk] = useState(null);
  const [done, setDone] = useState(false);
  const studyMode = bare || playing;

  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [steps],
  );

  const correctOrder = sortedSteps.map((s, i) => s.text || `Шаг ${i + 1}`);

  const shuffled = useMemo(() => {
    const items = steps.map((s, i) => ({ id: `s${i}`, text: s.text || `Шаг ${i + 1}` }));
    if (!shuffle) return items;
    return [...items].sort(() => Math.random() - 0.5);
  }, [steps, shuffle]);

  const current = order.length > 0 ? order : shuffled.map((s) => s.id);

  const handleReorder = (next) => {
    setOrder(next);
    setChecked(false);
    setCheckOk(null);
  };

  const handleCheck = () => {
    setChecked(true);
    const correct = current.every((id, i) => {
      const step = shuffled.find((s) => s.id === id);
      return step?.text === correctOrder[i];
    });
    setCheckOk(correct);
    playInteractiveSound(appearance, correct ? "correct" : "wrong");
    if (correct) {
      playInteractiveSound(appearance, "end");
      setDone(true);
      onComplete?.(100);
    }
  };

  const isCorrect = checked && current.every((id, i) => {
    const step = shuffled.find((s) => s.id === id);
    return step?.text === correctOrder[i];
  });

  if (steps.length === 0) return null;

  if (done) {
    return (
      <CompletionScreen
        scorePercent={100}
        onRestart={() => { setOrder([]); setChecked(false); setCheckOk(null); setDone(false); }}
      />
    );
  }

  return (
    <div className={`cb-preview-sequence${studyMode ? " cb-preview-sequence--bare" : ""}`}>
      <SequenceOrderList
        items={shuffled}
        order={current}
        onReorder={handleReorder}
        showNumbers={!studyMode}
        bare={studyMode}
        checked={checked}
        correctOrder={correctOrder}
      />
      <button
        type="button"
        className={[
          studyMode ? "cb-play-check-btn" : "cb-btn cb-btn--primary cb-btn--sm",
          checkOk === true ? "cb-play-check-btn--ok" : "",
          checkOk === false ? "cb-play-check-btn--bad" : "",
        ].filter(Boolean).join(" ")}
        onClick={handleCheck}
        aria-label="Проверить"
      >
        {studyMode ? "✓" : "Проверить порядок"}
      </button>
      {checked ? (
        <p className={isCorrect ? "cb-preview-success" : "cb-preview-error"}>
          {isCorrect ? "Верно!" : "Есть ошибки — попробуйте ещё раз"}
        </p>
      ) : null}
    </div>
  );
}

function PlayIntro({ interactive, onStart }) {
  const typeMeta = interactive.type === "flashcards"
    ? "Карточки"
    : interactive.type === "matching"
      ? "Сопоставление"
      : interactive.type === "quiz"
        ? "Викторина"
        : interactive.type === "wheel"
          ? "Случайное колесо"
          : "Порядок";

  return (
    <div className="ix-play-intro">
      <p className="ix-play-intro__type">{typeMeta}</p>
      <h2 className="ix-play-intro__title">{getInteractiveDisplayTitle(interactive, "Интерактив")}</h2>
      <p className="ix-play-intro__text">
        {interactive.instruction || "Нажмите «Начать», чтобы пройти задание."}
      </p>
      <button type="button" className="ix-play-intro__start" onClick={onStart}>
        ▶ Начать
      </button>
    </div>
  );
}

export default function InteractivePlayer({
  interactive,
  bare = false,
  playing = false,
  appearance: appearanceProp,
  showIntro,
  onComplete,
}) {
  const appearance = useMemo(
    () => appearanceProp || resolveInteractiveAppearance(interactive),
    [appearanceProp, interactive],
  );
  const cardClass = appearance?.cardStyle?.css_class || "ix-cards--classic";
  const needsIntro = interactive.type === "wheel" ? false : (showIntro ?? bare);
  const [started, setStarted] = useState(!needsIntro || playing);

  useEffect(() => {
    if (bare) unlockInteractiveAudio();
  }, [bare]);

  useEffect(() => {
    if (playing) setStarted(true);
  }, [playing]);

  useEffect(() => {
    if (!started || !interactive) {
      stopInteractiveBackgroundSound();
      return undefined;
    }
    startInteractiveBackgroundSound(appearance);
    return () => stopInteractiveBackgroundSound();
  }, [started, interactive, appearance]);

  if (!interactive) return null;

  if (needsIntro && !started) {
    return (
      <div className={`interactive-player interactive-player--intro ${cardClass}`}>
        <PlayIntro interactive={interactive} onStart={() => setStarted(true)} />
      </div>
    );
  }

  const studyMode = bare || playing;

  return (
    <div className={`interactive-player${studyMode ? " interactive-player--bare" : ""} ${cardClass}`}>
      {interactive.type === "flashcards" ? (
        <FlashcardPlayer
          cards={interactive.cards || []}
          bare={bare}
          playing={playing}
          appearance={appearance}
          onComplete={onComplete}
        />
      ) : null}
      {interactive.type === "matching" ? (
        <MatchingPlayer
          pairs={interactive.pairs || []}
          shuffle={interactive.shufflePairs !== false}
          bare={bare}
          playing={playing}
          appearance={appearance}
          onComplete={onComplete}
        />
      ) : null}
      {interactive.type === "sequence" ? (
        <SequencePlayer
          steps={interactive.steps || []}
          shuffle={interactive.params?.shuffleQuestions !== false}
          bare={bare}
          playing={playing}
          appearance={appearance}
          onComplete={onComplete}
        />
      ) : null}
      {interactive.type === "quiz" ? (
        <QuizPlayer
          questions={interactive.questions || []}
          params={interactive.params || {}}
          title={getInteractiveDisplayTitle(interactive, "")}
          bare={bare}
          playing={playing}
          appearance={appearance}
          onComplete={onComplete}
        />
      ) : null}
      {interactive.type === "wheel" ? (
        <WheelPlayer
          interactive={interactive}
          bare={bare}
          playing={playing}
          appearance={appearance}
          onComplete={onComplete}
        />
      ) : null}
    </div>
  );
}

export function interactivePlayUrl(id) {
  return `/cabinet/interactives/${encodeURIComponent(id)}/play`;
}

export function openInteractivePlay(id) {
  window.open(interactivePlayUrl(id), "_blank", "noopener,noreferrer");
}
