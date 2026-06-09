import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  DEFAULT_SNIPPETS,
  codeStorageKey,
  type CodeLanguage,
} from "./types";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

type Props = {
  storageId: string;
  language: CodeLanguage;
  running: boolean;
  visible: boolean;
  getCodeRef: MutableRefObject<() => string>;
};

function loadStoredCode(storageId: string, lang: CodeLanguage) {
  try {
    return localStorage.getItem(codeStorageKey(storageId, lang)) ?? "";
  } catch {
    return "";
  }
}

function saveStoredCode(storageId: string, lang: CodeLanguage, code: string) {
  try {
    localStorage.setItem(codeStorageKey(storageId, lang), code);
  } catch {
    /* ignore quota */
  }
}

function CodeTabInner({
  storageId,
  language,
  running,
  visible,
  getCodeRef,
}: Props) {
  const [code, setCode] = useState(
    () => loadStoredCode(storageId, language) || DEFAULT_SNIPPETS[language]
  );
  const [editorReady, setEditorReady] = useState(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const stored = loadStoredCode(storageId, language);
    setCode(stored || DEFAULT_SNIPPETS[language]);
    setEditorReady(false);
  }, [storageId, language]);

  useEffect(() => {
    if (!visible) setEditorReady(false);
  }, [visible]);

  useEffect(() => {
    getCodeRef.current = () => code;
  }, [code, getCodeRef]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    []
  );

  const handleChange = useCallback(
    (next: string) => {
      setCode(next);
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveStoredCode(storageId, language, next);
      }, 700);
    },
    [storageId, language]
  );

  if (!visible) return null;

  if (!editorReady) {
    return (
      <button
        type="button"
        className="inf-code-editor-idle"
        onClick={() => setEditorReady(true)}
      >
        <span className="inf-code-editor-idle__title">Редактор кода</span>
        <span className="inf-code-editor-idle__hint">
          Нажмите, чтобы загрузить подсветку синтаксиса
        </span>
      </button>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="inf-code-editor__cm inf-code-editor__cm--loading">
          Загрузка редактора…
        </div>
      }
    >
      <CodeMirrorEditor value={code} onChange={handleChange} readOnly={running} />
    </Suspense>
  );
}

export default memo(CodeTabInner);
