import { memo } from "react";
import type { SaveStatus } from "./projectStorage";

type Props = {
  running: boolean;
  runtimeLoading: boolean;
  saveStatus: SaveStatus;
  onRun: () => void;
  onStop: () => void;
  onSave: () => void;
  onClearOutput: () => void;
};

function EditorToolbarInner({
  running,
  runtimeLoading,
  saveStatus,
  onRun,
  onStop,
  onSave,
  onClearOutput,
}: Props) {
  const saveLabel =
    saveStatus === "saving"
      ? "Сохраняется…"
      : saveStatus === "saved"
        ? "Сохранено"
        : saveStatus === "error"
          ? "Не удалось сохранить"
          : "";

  return (
    <div className="inf-code-toolbar">
      <div className="inf-code-toolbar__primary">
        {running ? (
          <button
            type="button"
            className="inf-code-toolbar__btn inf-code-toolbar__btn--stop"
            onClick={onStop}
            title="Остановить выполнение"
          >
            Остановить
          </button>
        ) : (
          <button
            type="button"
            className="inf-code-toolbar__btn inf-code-toolbar__btn--run"
            onClick={onRun}
            disabled={runtimeLoading}
            title="Запустить (Ctrl+Enter)"
          >
            Запустить
          </button>
        )}
      </div>

      <div className="inf-code-toolbar__secondary" role="group" aria-label="Дополнительные действия">
        <button
          type="button"
          className="inf-code-toolbar__btn inf-code-toolbar__btn--secondary"
          onClick={onSave}
          disabled={running}
          title="Сохранить проект"
        >
          Сохранить
        </button>
        <button
          type="button"
          className="inf-code-toolbar__btn inf-code-toolbar__btn--secondary"
          onClick={onClearOutput}
          disabled={running}
          title="Очистить вывод"
        >
          Очистить
        </button>
      </div>

      {saveLabel ? (
        <span
          className={`inf-code-toolbar__save${saveStatus === "error" ? " is-error" : saveStatus === "saved" ? " is-ok" : saveStatus === "saving" ? " is-pending" : ""}`}
          role="status"
          aria-live="polite"
        >
          {saveLabel}
        </span>
      ) : null}
    </div>
  );
}

export default memo(EditorToolbarInner);
