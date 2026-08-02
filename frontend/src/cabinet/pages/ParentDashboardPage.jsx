import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchParentDashboard } from "../../utils/cabinetAuth";
import ParentChildSwitcher from "../parent/ParentChildSwitcher";
import {
  StudentErrorState,
  StudentPageShell,
  StudentStatusBadge,
} from "../student/StudentSectionUi";

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function DashBlock({ title, linkLabel, linkTo, children, className = "" }) {
  return (
    <section className={`st-home-block ${className}`.trim()}>
      <div className="st-home-block__head">
        <h2 className="st-home-block__title">{title}</h2>
        {linkLabel && linkTo ? (
          <Link to={linkTo} className="st-home-block__link">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function ParentDashboardPage() {
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchParentDashboard(studentId ? { student_id: studentId } : {});
      setData(res);
      if (!studentId && res.active_child?.student_id) {
        const p = new URLSearchParams(params);
        p.set("student", String(res.active_child.student_id));
        setParams(p, { replace: true });
      }
    } catch (err) {
      setError(err.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [studentId, params, setParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchChild = (id) => {
    const p = new URLSearchParams(params);
    p.set("student", String(id));
    setParams(p);
  };

  if (loading) {
    return (
      <StudentPageShell className="st-dashboard">
        <div className="st-loading">Загрузка…</div>
      </StudentPageShell>
    );
  }

  if (error) {
    return (
      <StudentPageShell className="st-dashboard">
        <StudentErrorState message={error} onRetry={load} />
      </StudentPageShell>
    );
  }

  if (!data?.children?.length) {
    return (
      <StudentPageShell className="st-dashboard">
        <div className="st-empty">
          <h3 className="st-empty__title">К вашему аккаунту пока не привязан ученик</h3>
          <p className="st-empty__text">
            Приглашение отправляет преподаватель из карточки ученика — блок «Родители и доступ».
          </p>
        </div>
      </StudentPageShell>
    );
  }

  const child = data.active_child;
  const q = child?.student_id ? `?student=${child.student_id}` : "";

  return (
    <StudentPageShell className="st-dashboard">
      <ParentChildSwitcher
        kids={data.children}
        activeId={child?.student_id}
        onChange={switchChild}
      />

      {child ? (
        <section className="st-hero">
          <div>
            <h1 className="st-hero__title">{child.name}</h1>
            <p className="st-hero__text">
              {[child.grade ? `${child.grade} класс` : null, child.direction_label]
                .filter(Boolean)
                .join(" · ") || "Учёба ребёнка"}
              {child.teachers?.[0] ? ` · ${child.teachers[0].name}` : ""}
            </p>
          </div>
        </section>
      ) : null}

      <DashBlock title="Ближайший урок" linkLabel="Все занятия" linkTo={`/cabinet/parent/schedule${q}`}>
        {data.next_lesson ? (
          <div className="st-list-card">
            <strong>{data.next_lesson.title}</strong>
            <p className="st-muted">{formatWhen(data.next_lesson.starts_at)}</p>
            <p className="st-muted">{data.next_lesson.teacher_name}</p>
          </div>
        ) : (
          <p className="st-muted">Нет ближайших уроков</p>
        )}
      </DashBlock>

      <DashBlock title="Домашние задания" linkLabel="Все задания" linkTo={`/cabinet/parent/homework${q}`}>
        {(data.homework_attention || []).length === 0 ? (
          <p className="st-muted">Нет заданий, требующих внимания</p>
        ) : (
          <ul className="st-simple-list">
            {data.homework_attention.map((hw) => (
              <li key={hw.homework_id} className="st-list-card">
                <div className="st-list-card__row">
                  <span className="st-status-badge">ДЗ</span>
                  <strong>{hw.title}</strong>
                </div>
                <p className="st-muted">
                  {hw.status_label || hw.status}
                  {hw.due_at ? ` · до ${formatWhen(hw.due_at)}` : ""}
                  {hw.score_percent != null ? ` · ${hw.score_percent}%` : ""}
                </p>
                {hw.is_overdue ? <StudentStatusBadge status="overdue" label="Просрочено" /> : null}
              </li>
            ))}
          </ul>
        )}
      </DashBlock>

      <DashBlock title="Последние результаты" linkLabel="Все результаты" linkTo={`/cabinet/parent/results${q}`}>
        {(data.recent_results || []).length === 0 ? (
          <p className="st-muted">Пока нет результатов</p>
        ) : (
          <ul className="st-simple-list">
            {data.recent_results.slice(0, 6).map((item) => (
              <li key={item.id} className="st-list-card">
                <div className="st-list-card__row">
                  <span className="st-status-badge">{item.badge || item.entry_type_label || item.entry_type}</span>
                  <strong>{item.title}</strong>
                </div>
                <p className="st-muted">
                  {item.score_percent != null ? `${item.score_percent}%` : (item.status_label || item.status || "—")}
                  {item.date ? ` · ${item.date}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DashBlock>

      {data.attendance ? (
        <DashBlock title="Посещаемость">
          <p>
            {data.attendance.rate_percent != null
              ? `${data.attendance.rate_percent}%`
              : "Нет данных"}
          </p>
          <p className="st-muted">
            Присутствовал: {data.attendance.present_like} из {data.attendance.total}
          </p>
        </DashBlock>
      ) : null}

      <DashBlock title="Оплата" linkLabel="Подробнее" linkTo={`/cabinet/parent/billing${q}`}>
        {!data.billing || data.billing.allowed === false ? (
          <p className="st-muted">Финансовые данные скрыты преподавателем</p>
        ) : (
          <>
            <p>
              Долг: {data.billing.account?.summary?.debt_amount ?? "0"}{" "}
              {data.billing.account?.currency || "RUB"}
            </p>
            <p className="st-muted">
              Остаток по абонементу: {data.billing.account?.summary?.available_units ?? "—"}
            </p>
          </>
        )}
      </DashBlock>

      <DashBlock title="Уведомления">
        {(data.notifications || []).length === 0 ? (
          <p className="st-muted">Нет новых уведомлений</p>
        ) : (
          <ul className="st-simple-list">
            {data.notifications.slice(0, 5).map((n) => (
              <li key={n.id} className="st-list-card">
                <strong>{n.title}</strong>
                <p className="st-muted">{n.message}</p>
              </li>
            ))}
          </ul>
        )}
      </DashBlock>
    </StudentPageShell>
  );
}
