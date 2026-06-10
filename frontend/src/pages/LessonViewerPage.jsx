import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import "@cyntler/react-doc-viewer/dist/index.css";
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
      <div className="digital-flow-page min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status">
            <span className="visually-hidden">Загрузка...</span>
          </div>
          <p className="text-muted">Загружаем урок...</p>
        </div>
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="digital-flow-page min-h-screen flex flex-col items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-red-200 max-w-md w-full text-center">
          <h2 className="text-xl font-bold text-red-600 mb-2">Ошибка</h2>
          <p className="text-gray-600 mb-4">{error || "Урок не найден"}</p>
          <Link to="/lessons" className="btn btn-primary">
            Вернуться к каталогу
          </Link>
        </div>
      </div>
    );
  }

  const fileUrl = lesson.file_url;
  if (!fileUrl) {
    return (
      <div className="digital-flow-page min-h-screen flex flex-col items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-red-200 max-w-md w-full text-center">
          <h2 className="text-xl font-bold text-red-600 mb-2">Файл не найден</h2>
          <p className="text-gray-600 mb-4">Для этого урока не загружен файл.</p>
          <Link to="/lessons" className="btn btn-primary">
            Вернуться к каталогу
          </Link>
        </div>
      </div>
    );
  }

  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
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

  const docs = [
    { uri: fileUrl, fileName: lesson.title }
  ];

  return (
    <div className="h-screen w-full flex flex-col bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm z-10">
        <div>
          <h1 className="text-lg font-bold text-gray-900 m-0">{lesson.title}</h1>
          {lesson.topic && <p className="text-sm text-gray-500 m-0">{lesson.topic}</p>}
        </div>
        <div className="flex items-center gap-3">
          <a href={fileUrl} download className="btn btn-outline-primary btn-sm" target="_blank" rel="noreferrer">
            Скачать файл
          </a>
          <Link to="/lessons" className="btn btn-outline-secondary btn-sm">
            Закрыть
          </Link>
        </div>
      </header>
      
      {isLocalhost && isPptx && (
        <div className="bg-yellow-50 border-b border-yellow-200 p-3 text-sm text-yellow-800 text-center">
          <strong>Внимание:</strong> Вы просматриваете презентацию на локальном сервере (localhost). 
          Встроенный просмотрщик Microsoft Office не может получить доступ к локальным файлам. 
          Пожалуйста, скачайте файл для просмотра или проверьте на публичном сервере.
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        {isPdf ? (
          <iframe
            src={toSameOriginUrl(fileUrl)}
            title={lesson.title}
            style={{ height: "100%", width: "100%", border: "none" }}
          />
        ) : (
          <DocViewer 
            documents={docs} 
            pluginRenderers={DocViewerRenderers}
            style={{ height: "100%", width: "100%" }}
            config={{
              header: {
                disableHeader: true,
                disableFileName: true,
                retainURLParams: false
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
