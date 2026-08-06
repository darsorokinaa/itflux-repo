import { useLayoutEffect, useEffect, useState } from "react";
import {
  getStoredLessonToken,
  readAndStoreLessonTokenFromUrl,
  stripSensitiveParamsFromUrl,
} from "../utils/sensitiveUrl";

/**
 * Ссылка из ЛК: /lesson/join/?token=JWT
 * 1) Нормализуем путь со слэшем.
 * 2) Сразу убираем token из адресной строки (sessionStorage).
 * 3) Проверяем токен через /api/lesson/verify/.
 * 4) Один раз перезагружаем страницу — если nginx отдаёт HTML Django, откроется lesson_room.html.
 * 5) Если снова SPA — подсказка по nginx (токен уже валиден).
 */
export default function LessonJoinBridge() {
  const [status, setStatus] = useState("init");
  const [detail, setDetail] = useState(null);

  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === "/lesson/join") {
      url.pathname = "/lesson/join/";
      window.location.replace(url.toString());
      return;
    }
    // Сохраняем JWT, но не убираем из URL до reload — Django lesson_room
    // читает ?token= при первой отдаче HTML/WS.
    readAndStoreLessonTokenFromUrl();
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname !== "/lesson/join/" && url.pathname !== "/lesson/join") {
      return undefined;
    }

    const token = getStoredLessonToken() || readAndStoreLessonTokenFromUrl();
    if (!token) {
      setStatus("no_token");
      return undefined;
    }

    let cancelled = false;
    setStatus("verifying");

    fetch("/api/lesson/verify/", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Lesson-Token": token,
      },
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setStatus("bad_token");
          setDetail(data.error || data.detail || `HTTP ${res.status}`);
          return;
        }
        const reloadKey = "lesson_join_reload_after_verify";
        if (!sessionStorage.getItem(reloadKey)) {
          sessionStorage.setItem(reloadKey, "1");
          try {
            sessionStorage.setItem("lesson_join_last_ok", JSON.stringify(data));
          } catch {
            /* ignore */
          }
          // Token остаётся в URL на reload для Django-шаблона комнаты.
          window.location.reload();
          return;
        }
        // Остались в SPA — убираем секрет из адресной строки.
        stripSensitiveParamsFromUrl();
        setStatus("still_spa");
        try {
          const cached = sessionStorage.getItem("lesson_join_last_ok");
          if (cached) setDetail(JSON.parse(cached));
          else setDetail(data);
        } catch {
          setDetail(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("network");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "init" || status === "verifying") {
    return (
      <div className="app-shell-content" style={{ padding: "2rem", maxWidth: 560 }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: "0.75rem" }}>Вход в урок</h1>
        <p style={{ lineHeight: 1.5 }}>Проверяем ссылку из личного кабинета…</p>
      </div>
    );
  }

  if (status === "no_token") {
    return (
      <div className="app-shell-content" style={{ padding: "2rem", maxWidth: 560 }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: "0.75rem" }}>Нет токена</h1>
        <p className="error" style={{ lineHeight: 1.5 }}>
          В адресе нет параметра <code>token</code>. Откройте урок кнопкой «Начать урок» в личном кабинете.
        </p>
      </div>
    );
  }

  if (status === "bad_token") {
    return (
      <div className="app-shell-content" style={{ padding: "2rem", maxWidth: 560 }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: "0.75rem" }}>Ссылка недействительна</h1>
        <p className="error" style={{ lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          {detail || "Токен не принят сервером."}
        </p>
        <p style={{ marginTop: "1rem", lineHeight: 1.5, color: "#666", fontSize: "0.9rem" }}>
          Проверьте, что на сервере генератора в окружении задан тот же <code>LESSON_SECRET</code>, что подписывает JWT в
          кабинете.
        </p>
      </div>
    );
  }

  if (status === "network") {
    return (
      <div className="app-shell-content" style={{ padding: "2rem", maxWidth: 560 }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: "0.75rem" }}>Нет связи</h1>
        <p className="error" style={{ lineHeight: 1.5 }}>
          Не удалось вызвать <code>/api/lesson/verify/</code>. Проверьте сеть и что сайт генератора доступен.
        </p>
      </div>
    );
  }

  if (status === "still_spa" && detail) {
    return (
      <div className="app-shell-content" style={{ padding: "2rem", maxWidth: 560 }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: "0.75rem" }}>Токен принят</h1>
        <p style={{ lineHeight: 1.5, marginBottom: "1rem" }}>
          Комната: <strong>{detail.room_id}</strong>
          {detail.lesson_type ? (
            <>
              {" "}
              · роль: <strong>{detail.lesson_type}</strong>
            </>
          ) : null}
        </p>
        <p style={{ lineHeight: 1.5, marginBottom: "1rem" }}>
          Страница урока должна отдаваться <strong>Django</strong> по пути <code>/lesson/join/</code>, а не как обычный
          React-интерфейс. Сейчас снова загрузился SPA — настройте nginx: префикс <code>/lesson/</code> проксируйте на
          тот же ASGI/HTTP-процесс, что и API (см. <code>deploy/nginx.conf</code>).
        </p>
        <button
          type="button"
          className="add-button primary"
          style={{ cursor: "pointer" }}
          onClick={() => {
            sessionStorage.removeItem("lesson_join_reload_after_verify");
            sessionStorage.removeItem("lesson_join_last_ok");
            window.location.reload();
          }}
        >
          Попробовать снова
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell-content" style={{ padding: "2rem", maxWidth: 560 }}>
      <h1 style={{ fontSize: "1.35rem", marginBottom: "0.75rem" }}>Вход в урок</h1>
      <p style={{ marginBottom: "1rem", lineHeight: 1.5 }}>Не удалось отобразить состояние. Обновите страницу.</p>
      <button
        type="button"
        className="add-button primary"
        style={{ cursor: "pointer" }}
        onClick={() => window.location.reload()}
      >
        Обновить
      </button>
    </div>
  );
}
