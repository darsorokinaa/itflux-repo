export type NewsItemData = {
  id: string;
  unread: boolean;
  title: string;
  meta: string;
};

const NEWS_ITEMS: ReadonlyArray<NewsItemData> = [
  {
    id: "1",
    unread: true,
    title: "Добавлены новые варианты ВПР по математике за 2024 год",
    meta: "2 мая · 8 новых вариантов",
  },
  {
    id: "2",
    unread: true,
    title: "Появилась автопроверка для заданий с развёрнутым ответом",
    meta: "28 апреля · Обновление платформы",
  },
  {
    id: "3",
    unread: false,
    title: "Обновлены задания ОГЭ по физике — добавлены задачи части 2",
    meta: "21 апреля · 34 новых задания",
  },
  {
    id: "4",
    unread: false,
    title: "Учителя теперь могут назначать задания с дедлайном",
    meta: "15 апреля · Для учителей",
  },
];

function splitMeta(meta: string): { date: string; detail: string } {
  const sep = meta.indexOf(" · ");
  if (sep === -1) return { date: meta, detail: "" };
  return {
    date: meta.slice(0, sep),
    detail: meta.slice(sep + 3),
  };
}

export default function NewsBlock() {
  return (
    <section className="updates-section" aria-labelledby="updates-section-heading">
      <header className="updates-section__head">
        <h2 id="updates-section-heading" className="updates-section__title">
          Обновления
        </h2>
      </header>

      <div role="list" className="updates-list">
        {NEWS_ITEMS.map((item) => {
          const { date, detail } = splitMeta(item.meta);
          return (
            <article
              key={item.id}
              role="listitem"
              className={`update-card${item.unread ? " update-card--new" : ""}`}
            >
              <div className="update-card__body">
                {item.unread ? (
                  <span className="update-card__tag">новое</span>
                ) : null}
                <h3 className="update-card__title">{item.title}</h3>
                {detail ? (
                  <p className="update-card__detail">{detail}</p>
                ) : null}
              </div>
              <time className="update-card__date" dateTime={date}>
                {date}
              </time>
            </article>
          );
        })}
      </div>
    </section>
  );
}
