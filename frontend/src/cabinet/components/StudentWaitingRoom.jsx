import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchVideoMeetingWaitingRoom } from "../../utils/cabinetAuth";
import ConnectionCheckButton from "../connectionCheck/ConnectionCheckButton";
import ConnectionCheckHost from "../connectionCheck/ConnectionCheckHost";

/**
 * Экран ожидания ученика, пока учитель не начал урок.
 * Проверка камеры/микрофона/связи — отдельная диагностическая комната (не комната урока).
 * Ссылки открываются в этой же вкладке (SPA-переход).
 */
export default function StudentWaitingRoom({ meetingUuid }) {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!meetingUuid) return undefined;
    let cancelled = false;
    fetchVideoMeetingWaitingRoom(meetingUuid)
      .then((payload) => {
        if (!cancelled) setData(payload || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        if (err?.code === "too_early" || err?.code === "window_closed") setNotice(err.message || "");
      });
    return () => {
      cancelled = true;
    };
  }, [meetingUuid]);

  const homework = data?.reminders?.homework || [];
  const previousTopic = data?.reminders?.previousTopic || null;
  const materials = data?.materials || [];
  const hasReminders = homework.length > 0 || Boolean(previousTopic);

  return (
    <div className="video-waiting-room" data-testid="student-waiting-room">
      {notice ? <p className="video-lesson-state__text">{notice}</p> : null}
      <div className="video-waiting-room__check">
        <p className="video-lesson-state__text">
          Пока учитель не подключился, можно проверить камеру, микрофон и связь.
        </p>
        <ConnectionCheckButton
          className="video-lesson-btn video-lesson-btn--primary"
          label="Проверить камеру и микрофон"
        />
        {/* Страница встречи живёт вне кабинетного layout — свой хост модала проверки. */}
        <ConnectionCheckHost />
      </div>

      {hasReminders ? (
        <section className="video-waiting-room__section" aria-label="Напоминания">
          <h3 className="video-waiting-room__heading">Напоминания</h3>
          <ul className="video-waiting-room__list">
            {homework.map((item) => (
              <li key={`hw-${item.id}`}>
                <Link to={item.href}>{item.text}</Link>
              </li>
            ))}
            {previousTopic ? <li>{previousTopic.text}</li> : null}
          </ul>
        </section>
      ) : null}

      {materials.length ? (
        <section className="video-waiting-room__section" aria-label="Материалы к уроку">
          <h3 className="video-waiting-room__heading">Материалы к уроку</h3>
          <ul className="video-waiting-room__list">
            {materials.map((item) => (
              <li key={`m-${item.id}`}>
                <Link to={item.href}>{item.title}</Link>
                {item.typeLabel ? <span className="video-waiting-room__meta"> · {item.typeLabel}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
