import "./TeacherQuotesBlock.css";

/**
 * r58: текстовый блок «Что говорят учителя» — дословные цитаты из переписки
 * с пользователями. Без имён, аватаров, оценок и цифр. Используется на / и /pricing.
 */
type TeacherQuote = {
  text: string;
  note?: string;
};

const TEACHER_QUOTES: ReadonlyArray<TeacherQuote> = [
  {
    text: "«Очень понравилось, что не нужно параллельно использовать много разных ресурсов, а всё сразу в одном месте».",
  },
  {
    text: "«Сайт очень удобный! Сейчас много учителей делают свою платформу, но ваша — одна из удобнейших по функционалу для меня. Генератор вариантов как родненький зашёл».",
  },
  {
    text: "«Пользуюсь „Цифровым потоком“ с недавнего времени, мне очень нравится».",
  },
  {
    text: "«Я планирую записать обзор на сайт, потому что это правда находка!»",
  },
  {
    text: "«Это супер. Очень удобно. Благодарю»",
    note: "о банке задач и готовых уроках",
  },
];

type Props = {
  className?: string;
  headingId?: string;
};

export default function TeacherQuotesBlock({ className = "", headingId = "teacher-quotes-heading" }: Props) {
  return (
    <section className={`teacher-quotes ${className}`.trim()} aria-labelledby={headingId}>
      <h2 id={headingId} className="teacher-quotes__title">
        Что говорят учителя
      </h2>
      <ul className="teacher-quotes__grid">
        {TEACHER_QUOTES.map((q) => (
          <li key={q.text} className="teacher-quotes__card">
            <blockquote className="teacher-quotes__quote">
              <p className="teacher-quotes__text">{q.text}</p>
            </blockquote>
            {q.note ? <p className="teacher-quotes__note">{q.note}</p> : null}
          </li>
        ))}
      </ul>
      <p className="teacher-quotes__caption">Из переписки с пользователями платформы</p>
    </section>
  );
}
