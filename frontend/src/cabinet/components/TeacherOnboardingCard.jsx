import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { trackActivationIntent } from "../activationAnalytics";
import { createTeacherMaterial, dismissUiNotice } from "../../utils/cabinetAuth";

function safePreviewPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    return "/lessons";
  }
  return path;
}

function progressLabel(done, total) {
  return `${done} из ${total} шагов выполнено`;
}

export default function TeacherOnboardingCard({ onboarding, onDismissed }) {
  const steps = Array.isArray(onboarding?.steps) ? onboarding.steps : [];
  const activationSteps = steps.filter((step) => step.key !== "registered");
  const completed = activationSteps.filter((step) => step.done).length;
  const total = onboarding?.total_steps || activationSteps.length || 3;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const cta = onboarding?.cta;
  const nextStep = onboarding?.next_step;
  const title = cta?.title || "Первые шаги";
  const [hiding, setHiding] = useState(false);

  const sampleReplacesChecklist = Boolean(onboarding?.sample_lesson && onboarding?.sample_next_step);

  useEffect(() => {
    if (!onboarding?.visible || sampleReplacesChecklist) return;
    if (nextStep === "student" || nextStep === "invite") {
      trackActivationIntent("add_student_cta_viewed", { source: "onboarding_card" });
    }
  }, [onboarding?.visible, nextStep, sampleReplacesChecklist]);

  if (!onboarding?.visible) return null;

  const dismiss = async () => {
    setHiding(true);
    try {
      await dismissUiNotice("first_day_checklist");
      onDismissed?.();
    } catch {
      setHiding(false);
    }
  };

  const sample = onboarding.sample_lesson;
  const sampleNext = onboarding.sample_next_step;
  if (sample?.title && sampleNext?.label && sampleNext?.href) {
    return (
      <EmptyCabinetSample
        sample={sample}
        nextStep={sampleNext}
        hiding={hiding}
        onDismiss={dismiss}
      />
    );
  }

  const onCtaClick = () => {
    if (onboarding.next_step === "student" || onboarding.next_step === "invite") {
      trackActivationIntent("add_student_clicked", { source: "onboarding_card" });
    } else if (onboarding.next_step === "share" || onboarding.next_step === "accepted") {
      trackActivationIntent("student_invite_share_clicked", { source: "onboarding_card" });
    }
  };

  return (
    <article className="td-card td-onboarding" aria-label={title}>
      <div className="td-onboarding__head">
        <div>
          <h2>{title}</h2>
          <p>{progressLabel(completed, total)}</p>
        </div>
        <div className="td-onboarding__actions">
          {cta ? (
            <Link to={cta.href} className="td-button td-button-primary" onClick={onCtaClick}>
              {cta.label}
            </Link>
          ) : null}
          <button type="button" className="td-onboarding__dismiss" onClick={dismiss} disabled={hiding}>
            Скрыть
          </button>
        </div>
      </div>

      <div
        className="td-onboarding__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={progressLabel(completed, total)}
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <ol className="td-onboarding__steps">
        {activationSteps.map((step) => {
          const done = step.done;
          return (
            <li
              key={step.key}
              className={`td-onboarding__step${done ? " is-done" : ""}${
                cta?.step === step.key ? " is-current" : ""
              }`}
            >
              <span className="td-onboarding__mark" aria-hidden="true">
                {done ? "✓" : "○"}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
      {cta?.hint ? <p className="td-onboarding__hint">{cta.hint}</p> : null}
      {cta?.alt_href ? (
        <p className="td-onboarding__alt">
          <Link to={cta.alt_href}>{cta.alt_label || "Собрать вариант"}</Link>
        </p>
      ) : null}
    </article>
  );
}

function EmptyCabinetSample({ sample, nextStep, hiding, onDismiss }) {
  const [taking, setTaking] = useState(false);
  const [taken, setTaken] = useState(false);
  const [takeError, setTakeError] = useState("");
  const previewPath = safePreviewPath(sample.preview_path);

  const takeIntoMaterials = async () => {
    if (taking || taken) return;
    setTaking(true);
    setTakeError("");
    try {
      const external = new URL(previewPath, window.location.origin).href;
      await createTeacherMaterial({
        title: sample.title,
        material_type: "lesson",
        external_url: external,
        topic: sample.subject || "",
        description: sample.short_description || "",
      });
      setTaken(true);
    } catch {
      setTakeError("Не удалось сохранить урок. Попробуйте ещё раз.");
      setTaking(false);
    }
  };

  return (
    <article className="td-card td-onboarding td-sample" aria-label="Пример урока">
      <div className="td-onboarding__head">
        <div>
          <h2>Пример урока</h2>
          <p>{sample.subject ? `${sample.subject}. ` : ""}{sample.title}</p>
        </div>
        <button type="button" className="td-onboarding__dismiss" onClick={onDismiss} disabled={hiding}>
          Скрыть
        </button>
      </div>
      {sample.short_description ? <p className="td-sample__lead">{sample.short_description}</p> : null}
      <div className="td-sample__actions">
        <Link to={previewPath} className="td-button">
          Открыть урок
        </Link>
        <button type="button" className="td-button" onClick={takeIntoMaterials} disabled={taking || taken}>
          {taken ? "В материалах" : "Взять в материалы"}
        </button>
      </div>
      {takeError ? <p className="td-sample__error">{takeError}</p> : null}
      <div className="td-sample__next">
        <Link to={nextStep.href} className="td-button td-button-primary">
          {nextStep.label}
        </Link>
      </div>
    </article>
  );
}
