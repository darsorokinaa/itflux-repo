import { useCallback, useMemo, useState } from "react";
import {
  openWorkbook,
  type WorkbookMeta,
  type WorkbookOptions,
  type WorkbookTask,
} from "../utils/buildWorkbookHtml";

const DEFAULT_OPTIONS: Required<WorkbookOptions> = {
  showGrading: true,
  showSolutionSpace: true,
  showAnswers: true,
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

  const handleCreate = useCallback(() => {
    if (!tasks.length) return;
    openWorkbook(tasks, { ...meta, options });
    onCreated();
  }, [meta, onCreated, options, tasks]);

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
            Поля для оценивания
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
            Место для решения
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
    </div>
  );
}
