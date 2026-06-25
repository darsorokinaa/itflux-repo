import { useMemo, useRef } from "react";
import {
  checkQuestionAnswer,
  computeQuizResult,
  gradeQuestionAnswer,
  shuffleArray,
} from "../quizUtils";
import { playInteractiveSound } from "../interactiveSounds";

function formatAnswerTexts(question, answerIds = []) {
  const texts = (question?.answers || [])
    .filter((answer) => answerIds.includes(answer.id))
    .map((answer) => answer.text?.trim() || "—");
  return texts.length ? texts.join(", ") : "—";
}

function getCorrectAnswerTexts(question) {
  const texts = (question?.answers || [])
    .filter((answer) => answer.is_correct)
    .map((answer) => answer.text?.trim() || "—");
  return texts.length ? texts.join(", ") : "—";
}

function buildMistakeItems(questions, result) {
  return (result.answers || [])
    .filter((record) => !record.is_correct)
    .map((record) => {
      const index = questions.findIndex((question) => question.id === record.question_id);
      const question = index >= 0 ? questions[index] : null;
      return {
        key: `${record.question_id}-${index}`,
        number: index >= 0 ? index + 1 : record.question_id,
        userAnswer: question ? formatAnswerTexts(question, record.selected_answer_ids) : null,
        correctAnswer: question ? getCorrectAnswerTexts(question) : null,
        explanation: question?.explanation?.trim() || null,
      };
    });
}

function getResultPresentation(percent, mistakeCount) {
  if (percent >= 90) {
    return {
      tier: "excellent",
      badge: "Отлично",
      subtitle: mistakeCount === 0 ? "Все ответы верные" : "Почти идеально",
      accent: "#10B981",
      badgeBg: "#ECFDF5",
      badgeColor: "#10B981",
      barColor: "#10B981",
      percentColor: "#10B981",
      recommendation: mistakeCount === 0
        ? "Можно перейти к следующему заданию."
        : "Повторите вопросы с ошибками для идеального результата.",
    };
  }
  if (percent >= 60) {
    return {
      tier: "good",
      badge: mistakeCount > 0 ? "Неплохо, но есть ошибка" : "Неплохо",
      subtitle: "Есть ошибки, можно повторить",
      accent: "#2563EB",
      badgeBg: "#EFF6FF",
      badgeColor: "#2563EB",
      barColor: "#2563EB",
      percentColor: "#2563EB",
      recommendation: "Повторите вопросы с ошибками и попробуйте ещё раз.",
    };
  }
  return {
    tier: "retry",
    badge: "Нужно повторить",
    subtitle: "Повторите материал и попробуйте ещё раз",
    accent: "#F59E0B",
    badgeBg: "#FFFBEB",
    badgeColor: "#D97706",
    barColor: "#F59E0B",
    percentColor: "#D97706",
    recommendation: "Повторите материал и попробуйте ещё раз.",
  };
}

function QuizResultScreen({
  result,
  questions,
  allowRetry,
  onRetry,
  onBack,
  showBack,
}) {
  const mistakesRef = useRef(null);
  const mistakeItems = useMemo(
    () => buildMistakeItems(questions, result),
    [questions, result],
  );
  const mistakeCount = result.total - result.correct_count;
  const presentation = getResultPresentation(result.percent, mistakeCount);

  const scrollToMistakes = () => {
    mistakesRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="ix-quiz-result-shell">
      <div
        className={`ix-quiz-result-card ix-quiz-result-card--${presentation.tier}`}
        style={{
          "--ix-quiz-result-accent": presentation.accent,
          "--ix-quiz-result-bar": presentation.barColor,
          "--ix-quiz-result-percent": presentation.percentColor,
          "--ix-quiz-result-badge-bg": presentation.badgeBg,
          "--ix-quiz-result-badge-color": presentation.badgeColor,
        }}
      >
        <div className="ix-quiz-result-card__head">
          <span className="ix-quiz-result-card__badge">{presentation.badge}</span>
          <p className="ix-quiz-result-card__subtitle">{presentation.subtitle}</p>
        </div>

        <div className="ix-quiz-result-card__hero">
          <p className="ix-quiz-result-card__score">
            {result.correct_count} из {result.total}
          </p>
          <p className="ix-quiz-result-card__percent">{result.percent}%</p>
        </div>

        <div
          className="ix-quiz-result-card__progress"
          role="progressbar"
          aria-valuenow={result.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Результат ${result.percent}%`}
        >
          <span
            className="ix-quiz-result-card__progress-fill"
            style={{ width: `${Math.max(0, Math.min(100, result.percent))}%` }}
          />
        </div>

        <div className="ix-quiz-result-card__stats">
          <div className="ix-quiz-result-stat">
            <span className="ix-quiz-result-stat__value">{result.correct_count}</span>
            <span className="ix-quiz-result-stat__label">Верно</span>
          </div>
          <div className="ix-quiz-result-stat">
            <span className="ix-quiz-result-stat__value">{mistakeCount}</span>
            <span className="ix-quiz-result-stat__label">Ошибки</span>
          </div>
          <div className="ix-quiz-result-stat">
            <span className="ix-quiz-result-stat__value">{result.total}</span>
            <span className="ix-quiz-result-stat__label">Всего</span>
          </div>
        </div>

        <section ref={mistakesRef} className="ix-quiz-result-card__mistakes">
          <h3 className="ix-quiz-result-card__mistakes-title">Ошибки</h3>
          {mistakeItems.length === 0 ? (
            <p className="ix-quiz-result-card__mistakes-empty">Ошибок нет</p>
          ) : (
            <div className="ix-quiz-result-card__mistakes-list">
              {mistakeItems.map((item) => (
                <article key={item.key} className="ix-quiz-result-mistake">
                  <p className="ix-quiz-result-mistake__title">Вопрос {item.number}</p>
                  {item.userAnswer ? (
                    <p className="ix-quiz-result-mistake__line">
                      <span>Ваш ответ:</span> {item.userAnswer}
                    </p>
                  ) : null}
                  {item.correctAnswer ? (
                    <p className="ix-quiz-result-mistake__line">
                      <span>Правильный ответ:</span> {item.correctAnswer}
                    </p>
                  ) : null}
                  {item.explanation ? (
                    <p className="ix-quiz-result-mistake__explain">{item.explanation}</p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="ix-quiz-result-card__recommendation">{presentation.recommendation}</p>

        <div className="ix-quiz-result-card__actions">
          {allowRetry ? (
            <button
              type="button"
              className="ix-quiz-result-btn ix-quiz-result-btn--primary"
              onClick={onRetry}
            >
              Повторить
            </button>
          ) : null}
          {mistakeItems.length > 0 ? (
            <button
              type="button"
              className="ix-quiz-result-btn ix-quiz-result-btn--secondary"
              onClick={scrollToMistakes}
            >
              Посмотреть ошибки
            </button>
          ) : null}
          {showBack ? (
            <button
              type="button"
              className="ix-quiz-result-btn ix-quiz-result-btn--ghost"
              onClick={onBack}
            >
              Вернуться
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function QuizQuestionView({
  question,
  index,
  total,
  selectedIds,
  onSelect,
  onSubmit,
  answered,
  isCorrect,
  showExplanation,
  showCorrectAnswers,
  preview = false,
}) {
  const answerType = question.answer_type || "single";

  const toggleAnswer = (answerId) => {
    if (answered) return;
    if (answerType === "single") {
      onSelect([answerId]);
      return;
    }
    onSelect(
      selectedIds.includes(answerId)
        ? selectedIds.filter((id) => id !== answerId)
        : [...selectedIds, answerId],
    );
  };

  return (
    <div className="ix-quiz-question-card">
      <p className="ix-quiz-question-card__progress">Вопрос {index + 1} / {total}</p>
      <h3 className="ix-quiz-question-card__text">{question.text || "—"}</h3>
      <div className="ix-quiz-play-answers">
        {(question.answers || []).map((answer) => {
          const selected = selectedIds.includes(answer.id);
          const revealCorrect = answered && showCorrectAnswers && answer.is_correct;
          const revealWrong = answered && selected && !answer.is_correct;
          return (
            <button
              key={answer.id}
              type="button"
              disabled={answered}
              className={[
                "ix-quiz-play-answer",
                selected ? "ix-quiz-play-answer--selected" : "",
                revealCorrect ? "ix-quiz-play-answer--correct" : "",
                revealWrong ? "ix-quiz-play-answer--wrong" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => toggleAnswer(answer.id)}
            >
              <span className="ix-quiz-play-answer__mark" aria-hidden="true">
                {answerType === "single"
                  ? (selected ? "●" : "○")
                  : (selected ? "✓" : "□")}
              </span>
              <span>{answer.text || "—"}</span>
            </button>
          );
        })}
      </div>

      {!answered ? (
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-btn--sm ix-quiz-submit"
          disabled={selectedIds.length === 0}
          onClick={onSubmit}
        >
          Ответить
        </button>
      ) : (
        <div className="ix-quiz-feedback">
          <p className={isCorrect ? "ix-quiz-feedback__ok" : "ix-quiz-feedback__bad"}>
            {isCorrect ? "Верно!" : "Неверно"}
          </p>
          {showExplanation && question.explanation ? (
            <p className="ix-quiz-feedback__explain">{question.explanation}</p>
          ) : null}
        </div>
      )}

      {preview && answered ? (
        <p className="ix-quiz-preview-note">Нажмите «Далее» для следующего вопроса</p>
      ) : null}
    </div>
  );
}

export default function QuizPlayer({
  questions: rawQuestions,
  params = {},
  title,
  bare,
  playing,
  appearance,
  onComplete,
  preview = false,
  showBack = false,
  onBack,
}) {
  const studyMode = bare || playing;
  const [index, setIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [records, setRecords] = useState([]);
  const [done, setDone] = useState(false);
  const [startedAt] = useState(() => Date.now());

  const questions = useMemo(() => {
    const list = (rawQuestions || []).filter((q) => (q.text || "").trim());
    return params.shuffleQuestions !== false ? shuffleArray(list) : list;
  }, [rawQuestions, params.shuffleQuestions]);

  const current = useMemo(() => {
    if (!questions[index]) return null;
    const q = questions[index];
    const answers = params.shuffleOptions !== false ? shuffleArray(q.answers || []) : (q.answers || []);
    return { ...q, answers };
  }, [questions, index, params.shuffleOptions]);

  const showExplanation = params.showExplanationAfterAnswer !== false;
  const showCorrectAfterAnswer = params.showCorrectImmediately === true;

  const resetRun = () => {
    setIndex(0);
    setSelectedIds([]);
    setAnswered(false);
    setIsCorrect(false);
    setRecords([]);
    setDone(false);
  };

  const handleSubmit = () => {
    if (!current || selectedIds.length === 0) return;
    const correct = checkQuestionAnswer(current, selectedIds);
    const record = gradeQuestionAnswer(current, selectedIds);
    playInteractiveSound(appearance, correct ? "correct" : "wrong");
    setIsCorrect(correct);
    setAnswered(true);
    setRecords((prev) => [...prev, record]);
  };

  const goNext = () => {
    if (index >= questions.length - 1) {
      const nextRecords = records;
      const result = computeQuizResult(questions, nextRecords);
      playInteractiveSound(appearance, "end");
      setDone(true);
      onComplete?.(result.percent, {
        ...result,
        duration_sec: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }
    playInteractiveSound(appearance, "next");
    setIndex((i) => i + 1);
    setSelectedIds([]);
    setAnswered(false);
    setIsCorrect(false);
  };

  if (questions.length === 0) {
    return <p className="ix-quiz-empty">Добавьте хотя бы один вопрос</p>;
  }

  if (done) {
    const result = computeQuizResult(questions, records);
    return (
      <QuizResultScreen
        result={result}
        questions={questions}
        allowRetry={params.allowRetry !== false}
        onRetry={resetRun}
        showBack={showBack}
        onBack={onBack}
      />
    );
  }

  return (
    <div className={`ix-quiz-player${studyMode ? " ix-quiz-player--bare" : ""}`}>
      {studyMode && title ? (
        <h2 className="ix-quiz-player__title">{title}</h2>
      ) : null}
      {current ? (
        <QuizQuestionView
          question={current}
          index={index}
          total={questions.length}
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          onSubmit={handleSubmit}
          answered={answered}
          isCorrect={isCorrect}
          showExplanation={showExplanation}
          showCorrectAnswers={showCorrectAfterAnswer}
          preview={preview}
        />
      ) : null}
      {answered && !preview ? (
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm ix-quiz-next" onClick={goNext}>
          {index >= questions.length - 1 ? "Завершить" : "Следующий вопрос"}
        </button>
      ) : null}
    </div>
  );
}

export function QuizStudentPreview({ questions, params }) {
  const [index, setIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const list = (questions || []).filter((q) => (q.text || "").trim());
  const total = list.length || 1;
  const current = list[index] || list[0];

  if (!current) {
    return <p className="ix-quiz-preview-empty">Добавьте вопрос для предпросмотра</p>;
  }

  const handleSubmit = () => {
    if (selectedIds.length === 0) return;
    setIsCorrect(checkQuestionAnswer(current, selectedIds));
    setAnswered(true);
  };

  const goNext = () => {
    setIndex((i) => (i + 1) % total);
    setSelectedIds([]);
    setAnswered(false);
    setIsCorrect(false);
  };

  return (
    <>
      <QuizQuestionView
        question={current}
        index={index}
        total={total}
        selectedIds={selectedIds}
        onSelect={setSelectedIds}
        onSubmit={handleSubmit}
        answered={answered}
        isCorrect={isCorrect}
        showExplanation={params?.showExplanationAfterAnswer !== false}
        showCorrectAnswers={params?.showCorrectImmediately === true}
        preview
      />
      <div className="ix-ed-preview-nav">
        <button
          type="button"
          className="ix-ed-preview-nav__btn ix-ed-preview-nav__btn--primary"
          disabled={!answered}
          onClick={goNext}
        >
          Далее
        </button>
        <span className="ix-ed-preview-nav__count">{index + 1} / {total}</span>
      </div>
    </>
  );
}
