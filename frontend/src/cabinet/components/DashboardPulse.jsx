import { useEffect, useMemo, useRef, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import {
  chooseNote,
  localIso,
  readMemory,
  rememberDailyNote,
  rememberSpotlight,
  writeMemory,
} from "../dashboardEngagement";

const BADGE_ICON = {
  "ach-lessons-1": "book",
  "ach-lessons-10": "book",
  "ach-lessons-50": "book",
  "ach-lessons-100": "book",
  "ach-tasks-100": "check",
  "ach-tasks-500": "check",
  "ach-tasks-1000": "check",
  "ach-homework-clear": "check",
  "ach-interactive": "spark",
};

function badgeIcon(id) {
  return BADGE_ICON[id] || "spark";
}

function badgePages(items) {
  const pages = [];
  for (let index = 0; index < items.length; index += 3) {
    pages.push(items.slice(index, index + 3));
  }
  return pages;
}

export default function DashboardPulse({ engagement, userId }) {
  const board = engagement?.board;
  const today = useMemo(() => localIso(new Date()), []);
  const [memory, setMemory] = useState(() => readMemory(userId));
  const [easterOpen, setEasterOpen] = useState(false);
  const [burst, setBurst] = useState(false);
  const [badgePage, setBadgePage] = useState(0);
  const [timeOpen, setTimeOpen] = useState(false);
  const badgeScrollerRef = useRef(null);

  const daily = useMemo(
    () => chooseNote(board?.daily?.candidates, memory, today),
    [board?.daily?.candidates, memory, today],
  );

  useEffect(() => {
    setMemory(readMemory(userId));
    setBurst(false);
    setEasterOpen(false);
    setTimeOpen(false);
  }, [userId]);

  useEffect(() => {
    if (!daily || userId == null) return;
    const current = readMemory(userId);
    if (current.noteToday?.date === today && current.noteToday?.id === daily.id) return;
    const next = rememberDailyNote(current, daily, today);
    writeMemory(userId, next);
    setMemory(next);
  }, [daily, userId, today]);

  useEffect(() => {
    const easter = board?.easter;
    if (!easter || userId == null) return;
    const current = readMemory(userId);
    if (current.seenAt?.[easter.id]) setEasterOpen(true);
  }, [board?.easter, userId]);

  if (!board) return null;

  const openEaster = () => {
    const easter = board.easter;
    if (!easter || easterOpen) return;
    setEasterOpen(true);
    if (easter.celebrate) setBurst(true);
    const current = readMemory(userId);
    const next = rememberSpotlight(current, {
      kind: "easter",
      id: easter.id,
      cooldown_days: easter.cooldown_days,
      title: easter.title,
    }, today);
    writeMemory(userId, next);
    setMemory(next);
  };

  const time = board.time;
  const achievements = board.achievements;
  const pages = badgePages(achievements.items || []);
  const pageCount = pages.length;
  const currentPage = Math.min(badgePage, Math.max(0, pageCount - 1));

  const scrollBadges = (next) => {
    const scroller = badgeScrollerRef.current;
    if (!scroller) return;
    const index = Math.max(0, Math.min(pageCount - 1, next));
    scroller.scrollTo({ left: index * scroller.clientWidth, behavior: "smooth" });
    setBadgePage(index);
  };

  const onBadgeScroll = () => {
    const scroller = badgeScrollerRef.current;
    if (!scroller || scroller.clientWidth === 0) return;
    setBadgePage(Math.round(scroller.scrollLeft / scroller.clientWidth));
  };

  return (
    <section className="td-rhythm" aria-label="Рабочий ритм">
      {board.streak ? (
        <div className="td-rhythm__streak">
          <span className="td-rhythm__streak-mark" aria-hidden="true">
            <CabinetIcon name="calendar" />
          </span>
          <span>
            <b>{board.streak.label}</b>
            <span>{board.streak.hint}</span>
          </span>
        </div>
      ) : null}

      <div className="td-rhythm__grid">
        <article className="td-card td-rhythm__time">
          <div className="td-rhythm__time-row">
            <div>
              <h3>Сэкономлено времени</h3>
            </div>
            <span className="td-rhythm__time-icon" aria-hidden="true"><CabinetIcon name="clock" /></span>
          </div>
          <p className="td-rhythm__time-value">{time.value}</p>
          <p className="td-rhythm__time-note">{time.scope}</p>
          <button
            type="button"
            className="td-rhythm__calc-btn"
            aria-expanded={timeOpen}
            onClick={() => setTimeOpen((open) => !open)}
          >
            Как посчитали
          </button>
          {timeOpen ? (
            <div className="td-rhythm__calc">
              {time.parts?.length ? (
                <ul className="td-rhythm__time-parts">
                  {time.parts.map((part) => (
                    <li key={part.key || part.label}>
                      <b>{part.label}</b>
                      <span>{part.formula || part.count}</span>
                      <b>{part.value}</b>
                    </li>
                  ))}
                  {time.total ? (
                    <li className="is-total">
                      <b>{time.total.label}</b>
                      <b>{time.total.value}</b>
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <p className="td-rhythm__time-foot">{time.note || time.hint}</p>
            </div>
          ) : null}
          <div className="td-rhythm__time-goal">
            <div className="td-rhythm__progress-head">
              <span>{time.mark_label}</span>
              <b>{time.mark_value}</b>
            </div>
            <div className="td-rhythm__bar td-rhythm__bar--green" role="progressbar" aria-valuenow={time.percent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${time.percent}%` }} />
            </div>
          </div>
        </article>

        <div className="td-rhythm__side">
          <article className="td-card td-rhythm__daily">
            <div className="td-rhythm__daily-top">
              <h3>Сообщение дня</h3>
              <span>{board.daily.date_label}</span>
            </div>
            <p className="td-rhythm__quote">{daily?.text ? `«${daily.text}»` : "Новая фраза появится завтра."}</p>
            <p className="td-rhythm__caption">{board.daily.caption}</p>
          </article>

          <article className="td-card td-rhythm__section">
            <div className="td-rhythm__section-head">
              <h3>Достижения</h3>
              <span className="td-rhythm__pager-nav">
                {pageCount > 1 ? (
                  <button
                    type="button"
                    aria-label="Предыдущие достижения"
                    disabled={currentPage === 0}
                    onClick={() => scrollBadges(currentPage - 1)}
                  >
                    <CabinetIcon name="arrowLeft" />
                  </button>
                ) : null}
                <span className="td-rhythm__count">{achievements.opened} открыто</span>
                {pageCount > 1 ? (
                  <button
                    type="button"
                    aria-label="Следующие достижения"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => scrollBadges(currentPage + 1)}
                  >
                    <CabinetIcon name="arrow" />
                  </button>
                ) : null}
              </span>
            </div>
            <div
              className="td-rhythm__badges"
              ref={badgeScrollerRef}
              onScroll={onBadgeScroll}
            >
              {pages.map((page) => (
                <div key={page[0].id} className="td-rhythm__badge-page">
                  {page.map((item) => (
                    <div key={item.id} className={`td-rhythm__badge${item.locked ? " is-locked" : " is-done"}`}>
                      <span className="td-rhythm__badge-icon" aria-hidden="true">
                        <CabinetIcon name={badgeIcon(item.id)} />
                      </span>
                      <span className="td-rhythm__badge-copy">
                        <b>{item.title}</b>
                        <span>{item.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="td-rhythm__milestone">
              <div className="td-rhythm__progress-head">
                <b>{achievements.milestone.title}</b>
                <span>{achievements.milestone.current} / {achievements.milestone.target}</span>
              </div>
              <div className="td-rhythm__bar td-rhythm__bar--amber" role="progressbar" aria-valuenow={achievements.milestone.percent} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${achievements.milestone.percent}%` }} />
              </div>
            </div>
          </article>
        </div>
      </div>

      {board.easter ? (
        <div className={`td-rhythm__easter${burst ? " is-rare" : ""}`}>
          <div className="td-rhythm__easter-copy">
            <span className="td-rhythm__spark" aria-hidden="true"><CabinetIcon name="spark" /></span>
            <span>
              <b>{easterOpen ? board.easter.title : "Здесь спрятана маленькая пасхалка"}</b>
              <span>
                {easterOpen
                  ? (board.easter.body || "Её можно просто заметить и идти дальше.")
                  : "Она открывается по реальному событию, не по входу в кабинет."}
              </span>
            </span>
          </div>
          <button type="button" onClick={openEaster} disabled={easterOpen}>
            {easterOpen ? "Открыто" : "Открыть"}
          </button>
          {burst ? (
            <span className="td-spot__confetti" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
