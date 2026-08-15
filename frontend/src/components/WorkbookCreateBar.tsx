import { useCallback, useMemo, useState } from "react";
import { useAnonLimitModal } from "../hooks/useAnonLimitModal";
import {
  openWorkbook,
  type WorkbookMeta,
  type WorkbookOptions,
  type WorkbookTask,
} from "../utils/buildWorkbookHtml";

const DEFAULT_OPTIONS: Required<WorkbookOptions> = {
  showGrading: false,
  showSolutionSpace: true,
  showAnswers: true,
  showAnswerKey: false,
  showTaskIds: false,
  showStudentLine: true,
};

type WorkbookCreateBarProps = {
  active: boolean;
  tasks: WorkbookTask[];
  meta: Omit<WorkbookMeta, "options">;
  onCreated: () => void;
};

export default function WorkbookCreateBar({
  active,
  tasks,
  meta,
  onCreated,
}: WorkbookCreateBarProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [options, setOptions] = useState<Required<WorkbookOptions>>(DEFAULT_OPTIONS);
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
    if (!tasks.length) return;
    try {
      const readCsrf = () => {
        const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : "";
      };
      if (!readCsrf()) {
        await fetch("/api/csrf/", { credentials: "same-origin" });
      }
      const token = readCsrf();
      const res = await fetch("/api/cabinet/usage/workbook/", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-CSRFToken": token } : {}),
        },
        body: "{}",
      });
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (openFromError(data)) return;
        window.alert(
          data.message ||
            "Лимит рабочих тетрадей исчерпан. Зарегистрируйтесь или выберите тариф на /pricing/."
        );
        return;
      }
      if (!res.ok) {
        window.alert("Не удалось проверить лимит тетрадей. Повторите попытку.");
        return;
      }
    } catch {
      // Без подтверждения сервера лимит можно обойти — не создаём офлайн.
      window.alert("Нет связи с сервером. Создание тетради временно недоступно.");
      return;
    }
    openWorkbook(tasks, { ...meta, options });
    onCreated();
  }, [meta, onCreated, openFromError, options, tasks]);

  if (!active) return null;

  return (
    <div className="workbook-create-bar" role="region" aria-label="Создание рабочей тетради">
      {optionsOpen ? (
        <div className="workbook-create-bar__options">
          <span className="workbook-create-bar__options-title">Содержимое тетради</span>
          <label className="workbook-create-bar__option">
            <input
              type="checkbox"
              checked={options.showGrading}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, showGrading: e.target.checked }))
              }
            />
            Блок для учителя (внизу)
          </label>
          <label className="workbook-create-bar__option">
            <input
              type="checkbox"
              checked={options.showSolutionSpace}
              onChange={(e) =>
                setOptions((prev) => ({
                  ...prev,
                  showSolutionSpace: e.target.checked,
                }))
              }
            />
            Поле для решения (клетка)
          </label>
          <label className="workbook-create-bar__option">
            <input
              type="checkbox"
              checked={options.showAnswers}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, showAnswers: e.target.checked }))
              }
            />
            Строки для ответа
          </label>
          <label className="workbook-create-bar__option">
            <input
              type="checkbox"
              checked={options.showAnswerKey}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, showAnswerKey: e.target.checked }))
              }
            />
            Ответы
          </label>
          <label className="workbook-create-bar__option">
            <input
              type="checkbox"
              checked={options.showTaskIds}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, showTaskIds: e.target.checked }))
              }
            />
            ID задач
          </label>
          <label className="workbook-create-bar__option">
            <input
              type="checkbox"
              checked={options.showStudentLine}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, showStudentLine: e.target.checked }))
              }
            />
            Строка ученика
          </label>
        </div>
      ) : null}

      <div className="workbook-create-bar__actions">
        <span className="workbook-create-bar__count">{countLabel}</span>
        <button
          type="button"
          className="workbook-create-bar__settings"
          onClick={() => setOptionsOpen((v) => !v)}
          aria-expanded={optionsOpen ? "true" : "false"}
        >
          Настройки
        </button>
        <button
          type="button"
          className="workbook-create-bar__create"
          onClick={handleCreate}
          disabled={tasks.length === 0}
        >
          Создать тетрадь
        </button>
      </div>
      {anonLimitModal}
    </div>
  );
}
