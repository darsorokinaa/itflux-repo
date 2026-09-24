import { useMemo, useState } from "react";
import CollectionLessonRow from "./CollectionLessonRow";
import CollectionSection from "./CollectionSection";

export default function CollectionLessonList({ collection }) {
  const [filter, setFilter] = useState("all");
  const lessons = collection?.lessons || [];
  const showFilters = lessons.length >= 8 && collection?.access?.has_access;
  const visibleIds = useMemo(() => {
    return new Set(
      lessons
        .filter((lesson) => {
          if (filter === "viewed") return lesson.viewed;
          if (filter === "new") return !lesson.viewed;
          return true;
        })
        .map((lesson) => lesson.item_id || `${lesson.kind}-${lesson.id}`),
    );
  }, [lessons, filter]);
  const currentItem = collection?.progress?.viewed ? collection?.continue_lesson : null;
  const currentKey = currentItem?.item_id || (currentItem ? `${currentItem.kind}-${currentItem.id}` : null);

  const sections = collection?.sections || [];
  const loose = sections.length ? collection?.unsectioned || [] : lessons;

  return (
    <div className="lcol-program">
      {showFilters ? (
        <div className="lcol-filters" role="tablist" aria-label="Фильтр уроков">
          {[
            ["all", "Все уроки"],
            ["new", "Не просмотрено"],
            ["viewed", "Просмотрено"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`lcol-filters__btn${filter === id ? " lcol-filters__btn--active" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {sections.map((section) => {
        const rows = (section.lessons || []).filter((lesson) => visibleIds.has(lesson.item_id || `${lesson.kind}-${lesson.id}`));
        if (!rows.length) return null;
        return (
          <CollectionSection key={section.id} title={section.title}>
            {rows.map((lesson) => (
              <CollectionLessonRow
                key={lesson.item_id || `${lesson.kind}-${lesson.id}`}
                collection={collection}
                lesson={lesson}
                current={(lesson.item_id || `${lesson.kind}-${lesson.id}`) === currentKey}
              />
            ))}
          </CollectionSection>
        );
      })}
      {loose.filter((lesson) => visibleIds.has(lesson.item_id || `${lesson.kind}-${lesson.id}`)).length ? (
        <CollectionSection title="">
          {loose.filter((lesson) => visibleIds.has(lesson.item_id || `${lesson.kind}-${lesson.id}`)).map((lesson) => (
            <CollectionLessonRow
              key={lesson.item_id || `${lesson.kind}-${lesson.id}`}
              collection={collection}
              lesson={lesson}
              current={(lesson.item_id || `${lesson.kind}-${lesson.id}`) === currentKey}
            />
          ))}
        </CollectionSection>
      ) : null}
      {showFilters && visibleIds.size === 0 ? (
        <p className="lcol-program__empty">В этом фильтре уроков нет.</p>
      ) : null}
    </div>
  );
}
