import { useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import StudentNameModal from "./StudentNameModal";

/**
 * Модальное окно с результатами выполнения варианта.
 */
export default function ResultsModal({ open, onClose, results, onRetry }) {
  const [studentNameModalOpen, setStudentNameModalOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const formatLocalDate = (d) => {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}.${d.getFullYear()}`;
  };
  const formatLocalTime = (d) => {
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  };

  const handleDownloadReport = async (studentName) => {
    if (!results || reportLoading) return;
    setReportLoading(true);
    try {
      const startDate = results.startTime ? new Date(results.startTime) : null;
      const endDate = results.endTime ? new Date(results.endTime) : null;
      const payload = {
        studentName,
        variantId: results.variantId,
        startTime: results.startTime,
        endTime: results.endTime,
        dateSolutionLocal: startDate ? formatLocalDate(startDate) : "",
        timeStartLocal: startDate ? formatLocalTime(startDate) : "",
        timeEndLocal: endDate ? formatLocalTime(endDate) : "",
        totalTimeFormatted: results.totalTimeFormatted,
        taskTimes: results.taskTimes,
        checkedTasks: results.checkedTasks,
        scores: results.scores,
        totalScore: results.totalScore,
        maxScore: results.maxScore,
        scoreExam: results.scoreExam,
        scoreComment: results.scoreComment,
        markLevel: results.markLevel,
        tasks: results.tasks,
      };
      const res = await fetch(
        `/api/${results.level}/${results.subject}/report-pdf/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error("Ошибка загрузки отчёта");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${studentName.replace(/\s+/g, "-") || "report"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error(err);
      alert("Не удалось скачать отчёт. Попробуйте позже.");
    } finally {
      setReportLoading(false);
    }
  };

  const heroPresentation = useMemo(
    () => deriveHeroPresentation(open && results ? results : null),
    [open, results]
  );
  const thresholdMetric = useMemo(
    () => deriveThresholdMetric(open && results ? results : null),
    [open, results]
  );
  const modalTier = useMemo(
    () => deriveResultsModalTier(open && results ? results : null),
    [open, results]
  );

  useEffect(() => {
    if (!open || modalTier !== "high") return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.4 } });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [open, modalTier]);

  if (!open || !results) return null;

  const {
    totalTimeFormatted,
    taskTimes,
    totalScore,
    maxScore,
    scoreComment,
    examMode,
    fullyCorrectTaskCount,
    taskCountTotal,
    tasks,
    level,
  } = results;
  const taskIdToNumber = tasks?.reduce((acc, t) => ({ ...acc, [t.id]: t.number }), {}) ?? {};

  const taskTimesEntries =
    taskTimes && Object.keys(taskTimes).length > 0
      ? Object.entries(taskTimes).sort(
          ([a], [b]) => (taskIdToNumber[a] ?? 0) - (taskIdToNumber[b] ?? 0)
        )
      : [];

  const metricsPointsValue =
    examMode === "test"
      ? `${fullyCorrectTaskCount} / ${taskCountTotal}`
      : `${totalScore} / ${maxScore}`;

  const metricsPointsLabel = "Баллы";

  const lvNorm = String(level || "").toLowerCase();
  const isVpr =
    lvNorm === "vpr" ||
    String(results.examType || "").toLowerCase() === "vpr" ||
    String(level || "").toUpperCase() === "ВПР";

  const safeScore = Number(totalScore) || 0;
  const safeMaxScore = Number(maxScore) || 0;
  const percent = safeMaxScore > 0 ? Math.round((safeScore / safeMaxScore) * 100) : 0;

  const subtitle = buildResultSubtitle(results);
  const scoreSuffix = String(heroPresentation.suffix || "").trimStart();

  return (
    <>
    <div
      className="modal-backdrop modal-backdrop--tiered"
      data-results-tier={modalTier}
      onClick={onClose}
      role="presentation"
    >
      <section
        className="result-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="results-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="result-header">
          <div className="result-title-wrap">
            <h2 id="results-modal-title" className="result-title">
              Результаты
            </h2>
            <p className="result-subtitle">{subtitle}</p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="result-body">
          <div className="score-card">
            <div className="score-icon" aria-hidden="true">
              {modalTier === "low" ? (
                <IconXCircle className="result-modal-tier-icon result-modal-tier-icon--low" />
              ) : modalTier === "mid" ? (
                <IconCheckCircle className="result-modal-tier-icon result-modal-tier-icon--pulse" />
              ) : heroPresentation.iconKind === "check" ? (
                <IconCheckCircle className="result-modal-tier-icon" />
              ) : heroPresentation.iconKind === "warn" ? (
                <IconAlertCircle className="result-modal-tier-icon" />
              ) : (
                <IconXCircle className="result-modal-tier-icon" />
              )}
            </div>
            <div className="score-main">
              <span className="score-number">{heroPresentation.mainNum}</span>
              <span className="score-total">{scoreSuffix}</span>
            </div>
            {isVpr ? (
              <p className="score-note">
                Оценка по шкале не используется для ВПР — показаны первичные баллы и процент выполнения.
              </p>
            ) : heroPresentation.note ? (
              <p className="score-note">{heroPresentation.note}</p>
            ) : null}
          </div>

          <div className="stats-grid">
            <div className="stat-item">
              <p className="stat-label">{metricsPointsLabel}</p>
              <p className="stat-value">{metricsPointsValue}</p>
            </div>
            <div className="stat-item">
              <p className="stat-label">Время</p>
              <p className="stat-value">{totalTimeFormatted}</p>
            </div>
            {isVpr ? (
              <div className="stat-item">
                <p className="stat-label">Процент</p>
                <p className="stat-value percent">{percent}%</p>
                <div className="percent-bar" aria-hidden="true">
                  <div className="percent-fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
            ) : (
              <div className="stat-item">
                <p className="stat-label">Порог</p>
                <p className={`stat-value${thresholdMetric.failed ? " stat-value--danger" : ""}`}>{thresholdMetric.text}</p>
              </div>
            )}
          </div>

          {taskTimesEntries.length > 1 && (
            <section className="results-times-section result-modal-times">
              <h4 className="results-times-section__title">Время по заданиям</h4>
              <div className="results-times-scroll">
                <table className="results-times-table-compact">
                  <thead>
                    <tr>
                      <th>Задание</th>
                      <th>Время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskTimesEntries.map(([taskId, seconds]) => (
                      <tr key={taskId}>
                        <td>{taskIdToNumber[taskId] ?? taskId}</td>
                        <td>{formatDurationCompact(seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {scoreComment != null && String(scoreComment).trim() !== "" && (
            <p className="results-comment-plain">{scoreComment}</p>
          )}

          <div className="result-actions">
            {typeof onRetry === "function" && (
              <button type="button" className="result-btn primary" onClick={onRetry}>
                Попробовать ещё раз
              </button>
            )}
            <button
              type="button"
              className="result-btn secondary"
              onClick={() => setStudentNameModalOpen(true)}
              disabled={reportLoading}
            >
              {reportLoading ? "Загрузка…" : "Скачать отчёт"}
            </button>
          </div>
        </div>
      </section>
    </div>
    <StudentNameModal
      open={studentNameModalOpen}
      onClose={() => setStudentNameModalOpen(false)}
      onConfirm={(name) => {
        setStudentNameModalOpen(false);
        handleDownloadReport(name);
      }}
    />
    </>
  );
}

const SUBJECT_RESULT_LABELS = {
  inf: "Информатика",
  history: "История",
  rus: "Русский язык",
  chem: "Химия",
  phys: "Физика",
  lit: "Литература",
  bio: "Биология",
  math: "Математика",
  math_base: "Математика",
};

function buildResultSubtitle(r) {
  if (!r) return "";
  const lv = String(r.level || "").toLowerCase();
  const levelLabel =
    { vpr: "ВПР", oge: "ОГЭ", ege: "ЕГЭ" }[lv] ||
    (r.level != null && r.level !== "" ? String(r.level).toUpperCase() : "—");
  const subj =
    SUBJECT_RESULT_LABELS[String(r.subject || "").toLowerCase()] || r.subject || "—";
  const m = r.examMode;
  let part = "Полный вариант";
  if (m === "part1") part = "Часть 1";
  else if (m === "part2") part = "Часть 2";
  else if (m === "test") part = "Тренировка";
  return `${levelLabel} · ${subj} · ${part}`;
}

function deriveHeroPresentation(r) {
  if (!r) {
    return {
      heroClass: "results-hero--neutral",
      fg: "#757575",
      iconKind: "warn",
      mainNum: "—",
      suffix: "",
      variant: "neutral",
      note: null,
    };
  }
  const { examMode, scoreExam, markLevel, level, fullyCorrectTaskCount, taskCountTotal, totalScore, maxScore } = r;

  if (examMode === "test") {
    const total = taskCountTotal || 1;
    const ok = fullyCorrectTaskCount / total;
    let variant = "bad";
    if (ok >= 1) variant = "good";
    else if (ok >= 0.5) variant = "mid";
    const t = THEMES_TEST[variant];
    return {
      heroClass: t.heroClass,
      fg: t.fg,
      iconKind: variant === "good" ? "check" : variant === "mid" ? "warn" : "x",
      mainNum: String(fullyCorrectTaskCount),
      suffix: ` из ${taskCountTotal}`,
      variant,
      note: null,
    };
  }

  const lvl = String(level || "").toLowerCase();
  if (scoreExam != null && lvl === "oge") {
    const m = Math.round(Number(scoreExam));
    let tier = "bad";
    if (m >= 4) tier = "good";
    else if (m === 3) tier = "mid";
    const t = THEMES_OGE_MARK[tier];
    return {
      heroClass: t.heroClass,
      fg: t.fg,
      iconKind: tier === "good" ? "check" : tier === "mid" ? "warn" : "x",
      mainNum: String(scoreExam),
      suffix: " из 5",
      variant: tier,
      note: null,
    };
  }

  if (scoreExam != null && markLevel != null && markLevel >= 1 && markLevel <= 4) {
    let tier = "bad";
    if (markLevel >= 4) tier = "good";
    else if (markLevel === 3) tier = "mid";
    const t = THEMES_OGE_MARK[tier];
    return {
      heroClass: t.heroClass,
      fg: t.fg,
      iconKind: tier === "good" ? "check" : tier === "mid" ? "warn" : "x",
      mainNum: String(scoreExam),
      suffix: " из 100",
      variant: tier,
      note: null,
    };
  }

  if (scoreExam != null) {
    const s = Number(scoreExam);
    let tier = "bad";
    if (s >= 70) tier = "good";
    else if (s >= 46) tier = "mid";
    const t = THEMES_OGE_MARK[tier];
    return {
      heroClass: t.heroClass,
      fg: t.fg,
      iconKind: tier === "good" ? "check" : tier === "mid" ? "warn" : "x",
      mainNum: String(scoreExam),
      suffix: " из 100",
      variant: tier,
      note: null,
    };
  }

  const tNeutral = THEMES_TEST.neutral;
  return {
    heroClass: tNeutral.heroClass,
    fg: tNeutral.fg,
    iconKind: "warn",
    mainNum: String(totalScore),
    suffix: ` из ${maxScore}`,
    variant: "neutral",
    note: "Оценка по шкале не получена — показаны первичные баллы.",
  };
}

const THEMES_OGE_MARK = {
  good: {
    heroClass: "results-hero--good",
    fg: "#43A047",
  },
  mid: {
    heroClass: "results-hero--mid",
    fg: "#FB8C00",
  },
  bad: {
    heroClass: "results-hero--bad",
    fg: "#E53935",
  },
};

const THEMES_TEST = {
  good: THEMES_OGE_MARK.good,
  mid: THEMES_OGE_MARK.mid,
  bad: THEMES_OGE_MARK.bad,
  neutral: {
    heroClass: "results-hero--neutral",
    fg: "#757575",
  },
};

/** Анимация модалки: high (≥4 / «хорошо») — canvas-confetti; mid (3) — пульс check; low (≤2) — только fade + x; neutral — fade. */
function deriveResultsModalTier(results) {
  const h = deriveHeroPresentation(results);
  if (h.variant === "good") return "high";
  if (h.variant === "mid") return "mid";
  if (h.variant === "bad") return "low";
  return "neutral";
}

function deriveThresholdMetric(results) {
  if (!results || results.examMode === "test") {
    return { text: "—", failed: false };
  }
  const { markLevel } = results;
  if (markLevel == null) {
    return { text: "—", failed: false };
  }
  if (markLevel === 1) {
    return { text: "не пройден", failed: true };
  }
  if (markLevel === 2) {
    return { text: "на пороге", failed: false };
  }
  return { text: "пройден", failed: false };
}

function formatDurationCompact(seconds) {
  const sec = Number(seconds);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m > 99) return `${m}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function IconCheckCircle({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="44" height="44" fill="none" aria-hidden="true">
      <path
        d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m8 12.5 2.5 2.5 5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconXCircle({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="44" height="44" fill="none" aria-hidden="true">
      <path
        d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconAlertCircle({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="44" height="44" fill="none" aria-hidden="true">
      <path
        d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M12 8v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="1" fill="currentColor" />
    </svg>
  );
}
