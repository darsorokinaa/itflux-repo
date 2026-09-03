import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAnonLimitModal } from "../hooks/useAnonLimitModal";
import { rememberValueReached, trackValueGoal } from "../utils/valuePath";
import { rememberLastVariant } from "../utils/recentLessons";
import type { WorkbookTask } from "../utils/buildWorkbookHtml";

type VariantCreateBarProps = {
  active: boolean;
  tasks: WorkbookTask[];
  level: string;
  subject: string;
  subjectName: string;
  onCreated: () => void;
};

export default function VariantCreateBar({
  active,
  tasks,
  level,
  subject,
  subjectName,
  onCreated,
}: VariantCreateBarProps) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { modal: anonLimitModal, openFromError } = useAnonLimitModal();

  const countLabel = useMemo(() => {
    const n = tasks.length;
    const mod10 = n % 10;
    const mod100 = n % 100;
    let word = "заданий";
    if (mod100 < 11 || mod100 > 14) {
      if (mod10 === 1) word = "задание";
      else if (mod10 >= 2 && mod10 <= 4) word = "задания";
    }
    return `${n} ${word}`;
  }, [tasks.length]);

  const handleCreate = useCallback(async () => {
    if (!tasks.length || submitting) return;
    setSubmitting(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);

    try {
      const res = await fetch(
        `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/variant-from-ids/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({ task_ids: tasks.map((task) => task.id) }),
        }
      );
      window.clearTimeout(timeoutId);
      const text = await res.text();
      let data: {
        variant_id?: number;
        error?: string | { code?: string; message?: string };
        message?: string;
        code?: string;
        feature?: string;
        min_plan?: string;
      } | null = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(
            res.ok
              ? "Сервер вернул некорректный ответ. Обновите страницу и попробуйте снова."
              : `Не удалось сформировать вариант (${res.status || "ошибка сервера"})`
          );
        }
      }
      if (!res.ok) {
        const limitPayload = data?.code ? data : data?.error;
        const err = new Error(
          (typeof limitPayload === "object" && limitPayload?.message) ||
            data?.message ||
            (typeof data?.error === "string" ? data.error : "") ||
            res.statusText ||
            "Не удалось сформировать вариант"
        ) as Error & { data?: unknown; code?: string };
        err.data = typeof limitPayload === "object" ? limitPayload : data;
        err.code = (err.data as { code?: string } | undefined)?.code;
        throw err;
      }
      if (!data?.variant_id) {
        throw new Error("Сервер не вернул номер варианта");
      }
      trackValueGoal("generator_result_created", {
        level: String(level || ""),
        subject: String(subject || ""),
      });
      rememberValueReached("tasks");
      rememberLastVariant({ level, subject, variantId: data.variant_id });
      navigate(`/${level}/${subject}/variant/${data.variant_id}`, {
        state: { mode: "variant", subjectName },
      });
      onCreated();
    } catch (err) {
      window.clearTimeout(timeoutId);
      if (openFromError(err)) {
        setError(null);
      } else if (err instanceof Error && err.name === "AbortError") {
        setError("Сервер не ответил вовремя. Попробуйте ещё раз.");
      } else {
        setError(err instanceof Error ? err.message : "Не удалось сформировать вариант");
      }
    } finally {
      setSubmitting(false);
    }
  }, [level, navigate, onCreated, openFromError, subject, subjectName, submitting, tasks]);

  if (!active) return null;

  return (
    <div className="workbook-create-bar" role="region" aria-label="Создание варианта">
      {error ? (
        <p className="workbook-create-bar__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="workbook-create-bar__actions">
        <span className="workbook-create-bar__count">{countLabel}</span>
        <button
          type="button"
          className="workbook-create-bar__create"
          onClick={handleCreate}
          disabled={tasks.length === 0 || submitting}
        >
          {submitting ? "Формируем…" : "Создать вариант"}
        </button>
      </div>
      {anonLimitModal}
    </div>
  );
}
