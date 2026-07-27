function fmtPct(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function trendLabel(trend, delta) {
  if (trend === "up") return `растёт${delta != null ? ` (+${delta})` : ""}`;
  if (trend === "down") return `снижается${delta != null ? ` (${delta})` : ""}`;
  return "стабильно";
}

function buildSmoothPath(coords) {
  if (coords.length < 2) return "";
  if (coords.length === 2) {
    return `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)} L${coords[1].x.toFixed(1)},${coords[1].y.toFixed(1)}`;
  }
  let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i === 0 ? 0 : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function MiniSparkline({ series, valueKey = "overall_score", color = "#2f6fed" }) {
  const points = (series || [])
    .map((p, i) => ({ i, v: p[valueKey] == null ? null : Number(p[valueKey]), date: p.date }))
    .filter((p) => Number.isFinite(p.v));

  if (points.length < 2) {
    return <div className="jg-mini-spark jg-mini-spark--empty">мало данных</div>;
  }

  const w = 132;
  const h = 36;
  const padX = 3;
  const padY = 4;
  const minV = Math.min(...points.map((p) => p.v));
  const maxV = Math.max(...points.map((p) => p.v));
  const span = Math.max(maxV - minV, 1);
  const coords = points.map((p, idx) => {
    const x = padX + (idx / Math.max(points.length - 1, 1)) * (w - padX * 2);
    const y = h - padY - ((p.v - minV) / span) * (h - padY * 2);
    return { x, y, v: p.v };
  });
  const line = buildSmoothPath(coords);
  const last = coords[coords.length - 1];
  const area = `${line} L${last.x.toFixed(1)},${(h - 1).toFixed(1)} L${coords[0].x.toFixed(1)},${(h - 1).toFixed(1)} Z`;
  const gradId = `jg-spark-fill-${color.replace("#", "")}`;

  return (
    <svg className="jg-mini-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last.x} cy={last.y} r="3" fill={color} stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

function LineChart({ series, valueKey = "overall_score", color = "#2f6fed", empty = "Нет данных" }) {
  const points = (series || [])
    .map((p, i) => ({ ...p, i, v: p[valueKey] == null ? null : Number(p[valueKey]) }))
    .filter((p) => Number.isFinite(p.v));

  if (points.length < 2) {
    return <div className="jg-chart-empty">{empty}</div>;
  }

  const w = 320;
  const h = 140;
  const padX = 28;
  const padY = 18;
  const minV = Math.min(...points.map((p) => p.v), 0);
  const maxV = Math.max(...points.map((p) => p.v), 100);
  const span = Math.max(maxV - minV, 1);

  const coords = points.map((p, idx) => {
    const x = padX + (idx / Math.max(points.length - 1, 1)) * (w - padX * 2);
    const y = h - padY - ((p.v - minV) / span) * (h - padY * 2);
    return { x, y, ...p };
  });

  const path = buildSmoothPath(coords);
  const last = coords[coords.length - 1];
  const area = `${path} L${last.x.toFixed(1)},${h - padY} L${coords[0].x.toFixed(1)},${h - padY} Z`;
  const gradId = `jg-line-fill-${valueKey}-${color.replace("#", "")}`;

  return (
    <svg className="jg-line-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Динамика">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((tick) => {
        if (tick < minV || tick > maxV) return null;
        const y = h - padY - ((tick - minV) / span) * (h - padY * 2);
        return (
          <g key={tick}>
            <line x1={padX} y1={y} x2={w - padX} y2={y} className="jg-chart-grid" />
            <text x={4} y={y + 3} className="jg-chart-axis">{tick}</text>
          </g>
        );
      })}
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} className="jg-line-chart__line" style={{ stroke: color }} />
      {coords.map((c) => (
        <circle key={`${c.date}-${c.i}`} cx={c.x} cy={c.y} r={3.2} className="jg-line-chart__dot" style={{ fill: color }}>
          <title>{`${fmtDate(c.date)}: ${fmtPct(c.v)}${c.topic ? ` · ${c.topic}` : ""}`}</title>
        </circle>
      ))}
      <text x={padX} y={h - 2} className="jg-chart-axis">
        {fmtDate(coords[0].date)}
      </text>
      <text x={w - padX} y={h - 2} className="jg-chart-axis" textAnchor="end">
        {fmtDate(coords[coords.length - 1].date)}
      </text>
    </svg>
  );
}

function BarsChart({ items, empty = "Нет данных" }) {
  const rows = (items || []).filter((i) => Number(i.count) > 0 || Number(i.value) > 0);
  if (!rows.length) return <div className="jg-chart-empty">{empty}</div>;

  const max = Math.max(...rows.map((i) => Number(i.count ?? i.value) || 0), 1);

  return (
    <div className="jg-bars" role="list">
      {rows.map((row) => {
        const value = Number(row.count ?? row.value) || 0;
        const pct = Math.round((value / max) * 100);
        return (
          <div key={row.key || row.label || row.title} className="jg-bars__row" role="listitem">
            <div className="jg-bars__label">{row.label || row.title}</div>
            <div className="jg-bars__track">
              <div
                className={`jg-bars__fill${row.tone ? ` jg-bars__fill--${row.tone}` : ""}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="jg-bars__value">{row.display ?? value}</div>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({ segments, centerLabel, centerValue }) {
  const rows = (segments || []).filter((s) => Number(s.value) > 0);
  const total = rows.reduce((sum, s) => sum + Number(s.value), 0);
  if (!total) return <div className="jg-chart-empty">Нет данных по посещаемости</div>;

  const size = 132;
  const r = 48;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = 16;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="jg-donut-wrap">
      <svg className="jg-donut" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Посещаемость">
        <circle cx={cx} cy={cy} r={r} fill="none" className="jg-donut__track" strokeWidth={stroke} />
        {rows.map((seg) => {
          const len = (Number(seg.value) / total) * circ;
          const node = (
            <circle
              key={seg.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              className={`jg-donut__seg jg-donut__seg--${seg.tone || "muted"}`}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>{`${seg.label}: ${seg.value}`}</title>
            </circle>
          );
          offset += len;
          return node;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="jg-donut__value">
          {centerValue}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="jg-donut__label">
          {centerLabel}
        </text>
      </svg>
      <ul className="jg-donut-legend">
        {rows.map((seg) => (
          <li key={seg.key}>
            <span className={`jg-dot jg-dot--${seg.tone || "muted"}`} />
            {seg.label}
            <strong>{seg.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniRing({ value, color = "#2f6fed", label }) {
  const n = Number(value);
  const has = Number.isFinite(n);
  const pct = has ? Math.max(0, Math.min(100, n)) : 0;
  const size = 40;
  const r = 14;
  const stroke = 4;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="jg-mini-ring" title={label || undefined}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="jg-mini-ring__track"
          strokeWidth={stroke}
        />
        {has ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
        <text x={size / 2} y={size / 2 + 3.5} textAnchor="middle" className="jg-mini-ring__value">
          {has ? `${Math.round(pct)}` : "—"}
        </text>
      </svg>
    </div>
  );
}

function MiniHwBars({ byStatus }) {
  const toneMap = {
    full: "success",
    partial: "warning",
    not_done: "danger",
  };
  const rows = (byStatus || [])
    .filter((row) => Number(row.count) > 0)
    .slice(0, 3)
    .map((row) => ({
      key: row.status,
      label: row.label,
      count: Number(row.count) || 0,
      tone: toneMap[row.status] || "muted",
    }));
  if (!rows.length) {
    return <div className="jg-mini-hw jg-mini-hw--empty">нет ДЗ</div>;
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="jg-mini-hw" role="list" aria-label="Статусы ДЗ">
      {rows.map((row) => (
        <div key={row.key} className="jg-mini-hw__row" role="listitem" title={`${row.label}: ${row.count}`}>
          <div className="jg-mini-hw__track">
            <div
              className={`jg-mini-hw__fill jg-mini-hw__fill--${row.tone}`}
              style={{ width: `${Math.round((row.count / max) * 100)}%` }}
            />
          </div>
          <span className="jg-mini-hw__count">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function CompactSummary({ summary, detailsHref, loading }) {
  if (loading) {
    return <section className="jg-summary jg-summary--compact jg-summary--loading">Загрузка сводки…</section>;
  }
  if (!summary) return null;

  const lesson = summary.lesson_work || {};
  const homework = summary.homework || {};
  const attendance = summary.attendance || {};
  const series = summary.score_series || [];

  const trend = summary.trend || "flat";
  const trendText = trendLabel(trend, summary.trend_delta);

  return (
    <section className="jg-summary jg-summary--compact" aria-label="Краткая сводка успеваемости">
      <div className="jg-summary-compact__main">
        <div className="jg-summary-compact__metrics" role="list">
          <div className="jg-summary-compact__metric jg-summary-compact__metric--index" role="listitem">
            <span>Индекс</span>
            <strong>{fmtPct(summary.composite_index)}</strong>
          </div>
          <div className="jg-summary-compact__metric" role="listitem">
            <span>Урок</span>
            <strong>{fmtPct(lesson.avg_score)}</strong>
          </div>
          <div className="jg-summary-compact__metric" role="listitem">
            <span>ДЗ</span>
            <strong>{fmtPct(homework.avg_score ?? homework.completion_percent)}</strong>
          </div>
          <div className="jg-summary-compact__metric" role="listitem">
            <span>Посещ.</span>
            <strong>{fmtPct(attendance.attendance_rate_percent)}</strong>
          </div>
        </div>
        <div className="jg-summary-compact__charts">
          <div className="jg-summary-compact__spark">
            <div className="jg-summary-compact__spark-head">
              <span>Урок</span>
              <em className={`jg-summary-compact__trend jg-summary-compact__trend--${trend}`}>
                {trendText}
              </em>
            </div>
            <MiniSparkline series={series} valueKey="overall_score" color="#2f6fed" />
          </div>
          <div className="jg-summary-compact__spark jg-summary-compact__spark--teal">
            <div className="jg-summary-compact__spark-head">
              <span>Вариант</span>
              <em className="jg-summary-compact__trend">
                {lesson.avg_variant_score != null ? fmtPct(lesson.avg_variant_score) : "—"}
              </em>
            </div>
            <MiniSparkline series={series} valueKey="variant_score" color="#0d9488" />
          </div>
          <div className="jg-summary-compact__spark jg-summary-compact__spark--ring">
            <div className="jg-summary-compact__spark-head">
              <span>Посещ.</span>
            </div>
            <MiniRing
              value={attendance.attendance_rate_percent}
              color="#2f6fed"
              label={`Посещаемость ${fmtPct(attendance.attendance_rate_percent)}`}
            />
          </div>
          <div className="jg-summary-compact__spark jg-summary-compact__spark--hw">
            <div className="jg-summary-compact__spark-head">
              <span>ДЗ</span>
              <em className="jg-summary-compact__trend">
                {(homework.avg_score ?? homework.completion_percent) != null
                  ? fmtPct(homework.avg_score ?? homework.completion_percent)
                  : "—"}
              </em>
            </div>
            <MiniHwBars byStatus={homework.by_status} />
          </div>
        </div>
      </div>
      {detailsHref ? (
        <a
          className="jg-summary-compact__more"
          href={detailsHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Подробнее
        </a>
      ) : null}
    </section>
  );
}

function FullSummary({ summary, scopeType, loading }) {
  if (loading) {
    return <section className="jg-summary jg-summary--loading">Загрузка сводки…</section>;
  }
  if (!summary) return null;

  const lesson = summary.lesson_work || {};
  const homework = summary.homework || {};
  const attendance = summary.attendance || {};
  const series = summary.score_series || [];
  const criteria = summary.criteria || [];
  const ranking = summary.students_ranking || [];
  const insights = summary.insights || [];

  const attendanceSegments = [
    { key: "present", label: "Присутствовал", value: attendance.present || 0, tone: "success" },
    { key: "late", label: "Опоздал", value: attendance.late || 0, tone: "warning" },
    { key: "absent", label: "Отсутствовал", value: attendance.absent || 0, tone: "danger" },
    {
      key: "cancelled",
      label: "Отменено",
      value: (attendance.cancelled_by_student || 0) + (attendance.cancelled_by_teacher || 0),
      tone: "muted",
    },
    { key: "not_marked", label: "Не отмечено", value: attendance.not_marked || 0, tone: "muted" },
  ];

  const hwBars = (homework.by_status || []).map((row) => ({
    key: row.status,
    label: row.label,
    count: row.count,
    tone:
      row.status === "full"
        ? "success"
        : row.status === "partial"
          ? "warning"
          : row.status === "not_done"
            ? "danger"
            : "muted",
  }));

  const criteriaBars = criteria
    .filter((c) => c.avg != null)
    .map((c) => {
      const max = Number(c.max_value) || (c.scale_type === "percentage" ? 100 : 5);
      const ratio = max > 0 ? Number(c.avg) / max : 0;
      const pct = Math.round(ratio * 100);
      return {
        key: c.id || c.title,
        title: c.title,
        value: pct,
        display: `${c.avg}${c.count ? ` · n=${c.count}` : ""}`,
        tone: ratio >= 0.8 ? "success" : ratio >= 0.5 ? "warning" : "danger",
      };
    });

  return (
    <section className="jg-summary" aria-label="Сводка успеваемости">
      <header className="jg-summary__head">
        <div>
          <h2 className="jg-summary__title">Подробная сводка успеваемости</h2>
          <p className="jg-summary__sub">
            Урок, домашнее задание и посещаемость
            {summary.lessons_in_summary
              ? ` · по ${summary.lessons_in_summary} последним записям`
              : ""}
            {" · "}
            динамика {trendLabel(summary.trend, summary.trend_delta)}
          </p>
        </div>
        <div className="jg-summary__index">
          <span>Индекс</span>
          <strong>{fmtPct(summary.composite_index)}</strong>
          <small>урок 50% · ДЗ 25% · посещ. 25%</small>
        </div>
      </header>

      <div className="jg-summary__kpis">
        <article className="jg-kpi">
          <span>Работа на уроке</span>
          <strong>{fmtPct(lesson.avg_score)}</strong>
          <small>
            {lesson.scored_lessons || 0} оценок
            {lesson.avg_variant_score != null
              ? ` · вариант ${fmtPct(lesson.avg_variant_score)}`
              : ""}
          </small>
        </article>
        <article className="jg-kpi">
          <span>Домашние задания</span>
          <strong>{fmtPct(homework.avg_score ?? homework.completion_percent)}</strong>
          <small>
            выдано {homework.assigned_count || 0}
            {homework.avg_score != null
              ? ` · средний балл ${fmtPct(homework.avg_score)}`
              : homework.checked_count
                ? ` · проверено ${homework.checked_count}`
                : ""}
          </small>
        </article>
        <article className="jg-kpi">
          <span>Посещаемость</span>
          <strong>{fmtPct(attendance.attendance_rate_percent)}</strong>
          <small>
            {attendance.total_lessons || 0} уроков
            {attendance.total_late_minutes
              ? ` · опоздания ${attendance.total_late_minutes} мин`
              : ""}
          </small>
        </article>
        <article className="jg-kpi">
          <span>Внимание</span>
          <strong>{lesson.attention_count || 0}</strong>
          <small>комментариев: {lesson.comments_count || 0}</small>
        </article>
      </div>

      <div className="jg-summary__charts">
        <article className="jg-summary-card">
          <h3>Динамика результата на уроке</h3>
          <LineChart
            series={series}
            valueKey="overall_score"
            color="#2f6fed"
            empty="Пока мало оценок для графика"
          />
        </article>
        <article className="jg-summary-card">
          <h3>Работа с вариантом на уроке</h3>
          <LineChart
            series={series}
            valueKey="variant_score"
            color="#0d9488"
            empty="Нет данных по вариантам на уроке"
          />
        </article>
        <article className="jg-summary-card">
          <h3>Посещаемость</h3>
          <DonutChart
            segments={attendanceSegments}
            centerLabel="посещ."
            centerValue={fmtPct(attendance.attendance_rate_percent)}
          />
        </article>
        <article className="jg-summary-card">
          <h3>Домашние задания</h3>
          <BarsChart items={hwBars} empty="Статусы ДЗ ещё не заполнены" />
        </article>
        <article className="jg-summary-card jg-summary-card--wide">
          <h3>Критерии оценки</h3>
          <p className="jg-summary-card__hint">
            Пояснение к каждому критерию и средний результат за период
          </p>
          {criteria.length ? (
            <div className="jg-criteria-explain">
              <div className="jg-criteria-table-wrap">
                <table className="jg-criteria-table">
                  <thead>
                    <tr>
                      <th>Критерий</th>
                      <th>Что означает</th>
                      <th>Шкала</th>
                      <th>Среднее</th>
                      <th>Оценок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criteria.map((c) => (
                      <tr key={c.id || c.title}>
                        <td>
                          <strong>{c.title}</strong>
                        </td>
                        <td className="jg-criteria-table__desc">
                          {c.description?.trim() || "Описание пока не задано"}
                        </td>
                        <td>{c.scale_label || "—"}</td>
                        <td>{c.avg != null ? c.avg : "—"}</td>
                        <td>{c.count || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {criteriaBars.length ? (
                <div className="jg-criteria-bars">
                  <h4 className="jg-criteria-bars__title">Средние значения</h4>
                  <BarsChart items={criteriaBars} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="jg-chart-empty">Критерии пока не настроены</div>
          )}
        </article>
        {scopeType === "group" && ranking.length ? (
          <article className="jg-summary-card jg-summary-card--wide">
            <h3>Ученики группы</h3>
            <div className="jg-rank-table-wrap">
              <table className="jg-rank-table">
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Индекс</th>
                    <th>Урок</th>
                    <th>Вариант</th>
                    <th>ДЗ</th>
                    <th>Посещ.</th>
                    <th>Уроков</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((row) => (
                    <tr key={row.student_id}>
                      <td>{row.student_name}</td>
                      <td>{fmtPct(row.performance_index)}</td>
                      <td>{fmtPct(row.avg_lesson_score)}</td>
                      <td>{fmtPct(row.avg_variant_score)}</td>
                      <td>{fmtPct(row.homework_rate)}</td>
                      <td>{fmtPct(row.attendance_rate)}</td>
                      <td>{row.lessons_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ) : null}
      </div>

      {insights.length ? (
        <ul className="jg-summary__insights">
          {insights.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Сводка успеваемости.
 * compact — мини-блок над таблицей; full — подробная страница.
 */
export default function JournalPerformanceSummary({
  summary,
  scopeType,
  loading,
  variant = "full",
  detailsHref = "",
}) {
  if (variant === "compact") {
    return (
      <CompactSummary
        summary={summary}
        detailsHref={detailsHref}
        loading={loading}
      />
    );
  }
  return (
    <FullSummary
      summary={summary}
      scopeType={scopeType}
      loading={loading}
    />
  );
}
