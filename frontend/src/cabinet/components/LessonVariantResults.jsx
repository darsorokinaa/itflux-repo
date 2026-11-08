import { useState } from "react";
import HomeworkResultBlock from "./HomeworkResultBlock";
import { variantScoreLabel } from "./lessonVariantResults";

function variantKey(variant, index) {
  return String(variant.homework_id || variant.variant_id || variant.variantId || variant.title || index);
}

function attemptScore(attempt) {
  if (!attempt || attempt.score == null || attempt.score === "") return null;
  if (!attempt.is_final && attempt.status !== "checked") return null;
  const score = Number(attempt.score);
  if (!Number.isFinite(score)) return null;
  return Number.isInteger(score) ? `${score}%` : `${score.toFixed(1)}%`;
}

async function copyReport(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("clipboard");
}

function downloadReport(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "otchet-roditelyu.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Все варианты одного урока и, у учителя, текст отчёта для родителя.
 * Подробности открываются готовой карточкой HomeworkResultBlock.
 * Отчёт только копируется или скачивается — сам никуда не уходит.
 */
export default function LessonVariantResults({
  variants = [],
  parentReport = "",
  reportFilename = "otchet-roditelyu.txt",
  showParentReport = false,
  showCorrectAnswer = true,
}) {
  const [openKey, setOpenKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const items = Array.isArray(variants) ? variants : [];

  const onCopy = async () => {
    setCopyError("");
    try {
      await copyReport(parentReport);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Не удалось скопировать. Выделите текст отчёта вручную.");
    }
  };

  return (
    <section className="jl-lesson-variants" aria-label="Варианты на уроке">
      <div className="jl-lesson-variants__results">
        <h4 className="jl-lesson-variants__title">Варианты на уроке</h4>
        {!items.length ? (
          <p className="jl-lesson-variants__empty">На этом уроке варианты не выдавались.</p>
        ) : (
          <ul className="jl-lesson-variants__list">
            {items.map((variant, index) => {
              const key = variantKey(variant, index);
              const open = openKey === key;
              const score = variantScoreLabel(variant);
              const tasks = Array.isArray(variant.tasks) ? variant.tasks : [];
              const attempts = Array.isArray(variant.attempts) ? variant.attempts : [];
              return (
                <li key={key} className="jl-lesson-variants__item">
                  <div className="jl-lesson-variants__row">
                    <div className="jl-lesson-variants__name">
                      <strong>{variant.title || (variant.variant_number ? `Вариант №${variant.variant_number}` : "Вариант")}</strong>
                      <span className={`jl-lesson-variants__status jl-lesson-variants__status--${variant.status || "issued"}`}>
                        {variant.status_label || "Выдан"}
                      </span>
                    </div>
                    <div className="jl-lesson-variants__score">
                      {score || "Балл не выставлен"}
                    </div>
                    <button
                      type="button"
                      className="jl-btn jl-btn--outline jl-btn--sm"
                      aria-expanded={open}
                      onClick={() => setOpenKey(open ? null : key)}
                    >
                      {open ? "Скрыть результат" : "Подробный результат"}
                    </button>
                  </div>
                  {open ? (
                    <div className="jl-lesson-variants__detail">
                      {tasks.length ? (
                        <HomeworkResultBlock
                          result={variant}
                          showCorrectAnswer={showCorrectAnswer}
                          hideHead
                        />
                      ) : (
                        <p className="jl-lesson-variants__empty">
                          Проверенных ответов пока нет. Незавершённый вариант не считается нулём.
                        </p>
                      )}
                      {attempts.length ? (
                        <div className="jl-lesson-variants__attempts">
                          <h5>История попыток</h5>
                          <ul>
                            {attempts.map((attempt) => {
                              const attemptLabel = attemptScore(attempt);
                              return (
                                <li key={attempt.id || attempt.attempt_number}>
                                  #{attempt.attempt_number}: {attempt.status_label || attempt.status || "—"}
                                  {attemptLabel ? ` · ${attemptLabel}` : ""}
                                  {attempt.teacher_comment ? ` — ${attempt.teacher_comment}` : ""}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {showParentReport ? (
        <aside className="jl-lesson-variants__report" aria-label="Отчёт для родителя">
          <h4 className="jl-lesson-variants__title">Отчёт для родителя</h4>
          <p className="jl-lesson-variants__hint">
            Текст никому не отправляется. Скопируйте или скачайте его и передайте родителю сами.
          </p>
          <pre className="jl-lesson-variants__text" aria-label="Текст отчёта для родителя">{parentReport || "Сводку можно будет скопировать, когда появятся итоги урока."}</pre>
          <div className="jl-lesson-variants__actions">
            <button
              type="button"
              className="jl-btn jl-btn--outline"
              onClick={() => void onCopy()}
              disabled={!parentReport}
            >
              {copied ? "Скопировано" : "Скопировать"}
            </button>
            <button
              type="button"
              className="jl-btn jl-btn--ghost"
              onClick={() => downloadReport(reportFilename, parentReport)}
              disabled={!parentReport}
            >
              Скачать
            </button>
          </div>
          {copyError ? <p className="jl-lesson-variants__error">{copyError}</p> : null}
        </aside>
      ) : null}
    </section>
  );
}
