import { useState } from "react";
import {
  cloneQuestion,
  createEmptyAnswer,
  createEmptyQuestion,
  summarizeQuestion,
} from "../quizUtils";
import { reorderList } from "../interactivesEditorUtils";
import InteractiveImageField from "./InteractiveImageField";

function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div className="ix-ed-segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`ix-ed-segmented__btn${value === opt.value ? " is-active" : ""}`}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function QuizAnswerRow({
  answer,
  answerType,
  onChange,
  onRemove,
  canRemove,
  onUploadImage,
  imageUploading,
}) {
  const toggleCorrect = () => {
    if (answerType === "single") {
      onChange({ ...answer, is_correct: true }, "single-select");
      return;
    }
    onChange({ ...answer, is_correct: !answer.is_correct });
  };

  return (
    <div className={`ix-quiz-answer${answer.is_correct ? " ix-quiz-answer--correct" : ""}`}>
      <button
        type="button"
        className="ix-quiz-answer__mark"
        aria-label={answer.is_correct ? "Правильный ответ" : "Отметить как правильный"}
        aria-pressed={answer.is_correct}
        onClick={toggleCorrect}
      >
        {answerType === "single" ? (answer.is_correct ? "●" : "○") : (answer.is_correct ? "✓" : "□")}
      </button>
      <div className="ix-quiz-answer__body">
        <input
          className="ix-quiz-answer__text"
          value={answer.text}
          placeholder="Текст ответа"
          onChange={(e) => onChange({ ...answer, text: e.target.value })}
        />
        <InteractiveImageField
          label="Картинка варианта"
          value={answer.image_url || ""}
          compact
          uploading={imageUploading}
          onUpload={async (file) => {
            const url = await onUploadImage(file);
            onChange({ ...answer, image_url: url });
          }}
          onClear={() => onChange({ ...answer, image_url: "" })}
        />
      </div>
      {canRemove ? (
        <button type="button" className="ix-quiz-answer__remove" onClick={onRemove} aria-label="Удалить вариант">
          ×
        </button>
      ) : null}
    </div>
  );
}

export default function QuizEditor({
  data,
  onQuestionsChange,
  onImageUpload,
  imageUploading = false,
  openIndex,
  setOpenIndex,
  isMobile,
  EditorItemShell,
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const updateQuestion = (index, patch) => {
    const questions = [...data.questions];
    questions[index] = { ...questions[index], ...patch };
    onQuestionsChange(questions);
  };

  const updateAnswer = (qIndex, aIndex, nextAnswer, mode) => {
    const question = data.questions[qIndex];
    let answers = [...question.answers];
    if (mode === "single-select") {
      answers = answers.map((a, i) => ({
        ...a,
        is_correct: i === aIndex,
      }));
    } else {
      answers[aIndex] = nextAnswer;
    }
    updateQuestion(qIndex, { answers });
  };

  const addQuestion = () => {
    onQuestionsChange([...data.questions, createEmptyQuestion()]);
    setOpenIndex(data.questions.length);
  };

  const removeQuestion = (index) => {
    if (data.questions.length <= 1) return;
    onQuestionsChange(data.questions.filter((_, i) => i !== index));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
  };

  const duplicateQuestion = (index) => {
    const questions = [...data.questions];
    questions.splice(index + 1, 0, cloneQuestion(data.questions[index]));
    onQuestionsChange(questions);
    setOpenIndex(index + 1);
  };

  const moveQuestion = (from, to) => {
    onQuestionsChange(reorderList(data.questions, from, to));
    setOpenIndex(to);
  };

  const addAnswer = (qIndex) => {
    const question = data.questions[qIndex];
    updateQuestion(qIndex, {
      answers: [...question.answers, createEmptyAnswer()],
    });
  };

  const removeAnswer = (qIndex, aIndex) => {
    const question = data.questions[qIndex];
    if (question.answers.length <= 2) return;
    updateQuestion(qIndex, {
      answers: question.answers.filter((_, i) => i !== aIndex),
    });
  };

  return (
    <section className="ix-ed-panel ix-ed-panel--work">
      <header className="ix-ed-panel__head ix-ed-panel__head--row">
        <div>
          <h2 className="ix-ed-panel__title">Вопросы викторины</h2>
          <p className="ix-ed-panel__hint">Текст вопроса, варианты и правильный ответ.</p>
        </div>
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill" onClick={addQuestion}>
          + Добавить вопрос
        </button>
      </header>
      <div className="ix-ed-panel__body ix-ed-panel__body--stack">
        {data.questions.map((question, index) => {
          const summary = question.text
            ? `«${question.text.length > 48 ? `${question.text.slice(0, 48)}…` : question.text}»`
            : "Пустой вопрос";
          const hint = summarizeQuestion(question);
          return (
            <EditorItemShell
              key={question.id || index}
              index={index}
              title={`Вопрос ${index + 1}`}
              summary={summary}
              hint={hint}
              open={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? -1 : index)}
              onDuplicate={() => duplicateQuestion(index)}
              onRemove={() => removeQuestion(index)}
              canRemove={data.questions.length > 1}
              onMoveUp={() => moveQuestion(index, index - 1)}
              onMoveDown={() => moveQuestion(index, index + 1)}
              canMoveUp={index > 0}
              canMoveDown={index < data.questions.length - 1}
              dragging={dragIndex === index}
              dragOver={overIndex === index && dragIndex !== index}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", String(index));
                setDragIndex(index);
              }}
              onDragOver={(e) => { e.preventDefault(); setOverIndex(index); }}
              onDrop={(e) => {
                e.preventDefault();
                moveQuestion(Number(e.dataTransfer.getData("text/plain")), index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              isMobile={isMobile}
            >
              <div className="ix-ed-fields ix-ed-fields--stack">
                <label className="ix-ed-field ix-ed-field--wide">
                  <span>Вопрос</span>
                  <textarea
                    rows={2}
                    value={question.text}
                    placeholder="Текст вопроса"
                    onChange={(e) => updateQuestion(index, { text: e.target.value })}
                  />
                </label>
                <InteractiveImageField
                  label="Картинка вопроса"
                  value={question.image_url || ""}
                  uploading={imageUploading}
                  onUpload={async (file) => {
                    const url = await onImageUpload(file);
                    updateQuestion(index, { image_url: url });
                  }}
                  onClear={() => updateQuestion(index, { image_url: "" })}
                />

                <div className="ix-ed-field">
                  <span>Тип ответа</span>
                  <SegmentedControl
                    ariaLabel="Тип ответа"
                    value={question.answer_type || "single"}
                    options={[
                      { value: "single", label: "Один правильный" },
                      { value: "multiple", label: "Несколько правильных" },
                    ]}
                    onChange={(val) => {
                      const answers = question.answers.map((a, i) => ({
                        ...a,
                        is_correct: val === "single" ? i === 0 : a.is_correct,
                      }));
                      updateQuestion(index, { answer_type: val, answers });
                    }}
                  />
                </div>

                <div className="ix-quiz-answers">
                  {(question.answers || []).map((answer, aIndex) => (
                    <QuizAnswerRow
                      key={answer.id || aIndex}
                      answer={answer}
                      answerType={question.answer_type || "single"}
                      canRemove={(question.answers || []).length > 2}
                      onUploadImage={onImageUpload}
                      imageUploading={imageUploading}
                      onChange={(next, mode) => updateAnswer(index, aIndex, next, mode)}
                      onRemove={() => removeAnswer(index, aIndex)}
                    />
                  ))}
                </div>

                <button type="button" className="ix-quiz-add-answer" onClick={() => addAnswer(index)}>
                  + Добавить вариант
                </button>

                <label className="ix-ed-field ix-ed-field--wide">
                  <span>Пояснение после ответа</span>
                  <input
                    value={question.explanation || ""}
                    placeholder="Необязательно"
                    onChange={(e) => updateQuestion(index, { explanation: e.target.value })}
                  />
                </label>

                <label className="ix-ed-field ix-ed-field--points">
                  <span>Баллы</span>
                  <input
                    type="number"
                    min={1}
                    value={question.points ?? 1}
                    onChange={(e) => updateQuestion(index, { points: Number(e.target.value) || 1 })}
                  />
                </label>
              </div>
            </EditorItemShell>
          );
        })}
      </div>
    </section>
  );
}
