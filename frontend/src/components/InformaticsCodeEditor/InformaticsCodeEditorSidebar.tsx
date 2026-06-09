import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import type { TaskFileSource } from "./types";

const InformaticsCodeEditorPanel = lazy(
  () => import("./InformaticsCodeEditorPanel")
);

const OPEN_KEY = "inf-code-sidebar-open";

type Props = {
  taskSources?: TaskFileSource[];
  getTaskSources?: () => TaskFileSource[];
  initialOpen?: boolean;
};

function readOpenState(fallback: boolean) {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeOpenState(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function InformaticsCodeEditorSidebarInner({
  taskSources = [],
  getTaskSources,
  initialOpen = false,
}: Props) {
  const [open, setOpen] = useState(() => readOpenState(initialOpen));
  const [panelMounted, setPanelMounted] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<number | string | null>(null);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    writeOpenState(open);
  }, [open]);

  useEffect(() => {
    document.documentElement.dataset.infCodeSidebar = open ? "open" : "collapsed";
    return () => {
      delete document.documentElement.dataset.infCodeSidebar;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanelMounted(false);
      return;
    }
    let cancelled = false;
    const mount = () => {
      if (!cancelled) setPanelMounted(true);
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(mount, { timeout: 800 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(mount, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open]);

  return (
    <aside
      ref={asideRef}
      className={`inf-code-sidebar${open ? " is-open" : " is-collapsed"}`}
      aria-label="Редактор кода"
    >
      <button
        type="button"
        className="inf-code-sidebar__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Свернуть редактор" : "Развернуть редактор"}
      >
        <span className="inf-code-sidebar__toggle-icon" aria-hidden="true">
          {"</>"}
        </span>
        {!open ? <span className="inf-code-sidebar__toggle-label">Код</span> : null}
      </button>

      {open && panelMounted ? (
        <div className="inf-code-sidebar__panel">
          <Suspense
            fallback={
              <div className="inf-code-editor-panel inf-code-editor-panel--loading">
                Загрузка редактора…
              </div>
            }
          >
            <InformaticsCodeEditorPanel
              active
              hostRef={asideRef}
              taskSources={taskSources}
              getTaskSources={getTaskSources}
              activeTaskId={activeTaskId}
              onActiveTaskChange={setActiveTaskId}
            />
          </Suspense>
        </div>
      ) : null}
    </aside>
  );
}

export default memo(InformaticsCodeEditorSidebarInner);
