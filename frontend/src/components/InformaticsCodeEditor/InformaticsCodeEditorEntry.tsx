import { lazy, Suspense, useCallback, useState } from "react";
import type { TaskFileSource } from "./types";
import "../../styles/informatics-code-editor.css";

const InformaticsCodeEditorSidebar = lazy(
  () => import("./InformaticsCodeEditorSidebar")
);

type Props = {
  getTaskSources?: () => TaskFileSource[];
};

/** Лёгкая оболочка: тяжёлый редактор грузится только после нажатия «Код». */
export default function InformaticsCodeEditorEntry({ getTaskSources }: Props) {
  const [engaged, setEngaged] = useState(false);

  const handleOpen = useCallback(() => {
    setEngaged(true);
  }, []);

  if (!engaged) {
    return (
      <aside className="inf-code-sidebar is-collapsed" aria-label="Редактор кода">
        <button
          type="button"
          className="inf-code-sidebar__toggle"
          onClick={handleOpen}
          aria-expanded={false}
          title="Развернуть редактор"
        >
          <span className="inf-code-sidebar__toggle-icon" aria-hidden="true">
            {"</>"}
          </span>
          <span className="inf-code-sidebar__toggle-label">Код</span>
        </button>
      </aside>
    );
  }

  return (
    <Suspense
      fallback={
        <aside className="inf-code-sidebar is-collapsed" aria-label="Редактор кода">
          <button type="button" className="inf-code-sidebar__toggle" disabled>
            <span className="inf-code-sidebar__toggle-icon" aria-hidden="true">
              {"</>"}
            </span>
            <span className="inf-code-sidebar__toggle-label">…</span>
          </button>
        </aside>
      }
    >
      <InformaticsCodeEditorSidebar
        getTaskSources={getTaskSources}
        initialOpen
      />
    </Suspense>
  );
}
