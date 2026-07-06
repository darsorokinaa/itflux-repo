import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { devApiBase } from "../utils/devApiBase";

export default function LessonViewerPage() {
  const { slug } = useParams();
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const apiBase = devApiBase();
    fetch(`${apiBase}/api/lessons/${encodeURIComponent(slug)}/`, {
      credentials: apiBase ? "omit" : "same-origin",
    })
      .then((res) => {
        if (!res.ok) throw new Error("Не удалось загрузить урок");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setLesson(data?.lesson || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="lesson-viewer-page lesson-viewer-page--loading">
        <p className="lesson-viewer-page__status">Загружаем урок…</p>
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="lesson-viewer-page lesson-viewer-page--error">
        <div className="lesson-viewer-page__error-card">
          <h2>Ошибка</h2>
          <p>{error || "Урок не найден"}</p>
          <Link to="/lessons" className="lesson-viewer-page__back">
            Вернуться к каталогу
          </Link>
        </div>
      </div>
    );
  }

  const fileUrl = lesson.file_url;
  if (!fileUrl) {
    return (
      <div className="lesson-viewer-page lesson-viewer-page--error">
        <div className="lesson-viewer-page__error-card">
          <h2>Файл не найден</h2>
          <p>Для этого урока не загружен файл.</p>
          <Link to="/lessons" className="lesson-viewer-page__back">
            Вернуться к каталогу
          </Link>
        </div>
      </div>
    );
  }

  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const fileExt = fileUrl.toLowerCase().split("?")[0];
  const isPptx = fileExt.endsWith(".pptx") || fileExt.endsWith(".ppt");
  const isPdf = fileExt.endsWith(".pdf");

  /**
   * Для встраивания (iframe) нужен тот же origin, иначе X-Frame-Options: SAMEORIGIN
   * на media блокирует показ. В dev /media проксируется Vite на Django, в проде origin
   * и так совпадает — поэтому используем относительный путь.
   */
  const toSameOriginUrl = (u) => {
    try {
      const parsed = new URL(u, window.location.href);
      return parsed.pathname + parsed.search;
    } catch {
      return u;
    }
  };

  const docs = [{ uri: fileUrl, fileName: lesson.title }];

  if (isPdf) {
    return (
      <div className="lesson-viewer-page lesson-viewer-page--pdf">
        <iframe
          src={toSameOriginUrl(fileUrl)}
          title={lesson.title}
          className="lesson-viewer-page__pdf-frame"
        />
      </div>
    );
  }

  return (
    <div className="lesson-viewer-page lesson-viewer-page--doc">
      {isLocalhost && isPptx ? (
        <div className="lesson-viewer-page__warn">
          <strong>Внимание:</strong> на localhost встроенный просмотр Office недоступен — скачайте
          файл или проверьте на публичном сервере.
        </div>
      ) : null}
      <main className="lesson-viewer-page__doc-main">
        <DocViewer
          documents={docs}
          pluginRenderers={DocViewerRenderers}
          style={{ height: "100%", width: "100%" }}
          config={{
            header: {
              disableHeader: true,
              disableFileName: true,
              retainURLParams: false,
            },
          }}
        />
      </main>
    </div>
  );
}
