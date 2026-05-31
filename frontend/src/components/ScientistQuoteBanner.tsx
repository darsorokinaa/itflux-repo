import { useMemo, useState } from "react";

type Quote = {
  author: string;
  initials: string;
  slug: string;
  bg: string;
  quote: string;
  note: string;
  /** Если фото есть в /public/img/scientists/, укажите путь; иначе — инициалы. */
  image?: string;
};

const QUOTES: ReadonlyArray<Quote> = [
  {
    author: "Альберт Эйнштейн",
    initials: "АЭ",
    slug: "einstein",
    bg: "linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)",
    image: "/img/scientists/einstein.png",
    quote:
      "Образование — это то, что остаётся, когда человек забывает всё, чему его учили в школе.",
    note:
      "Главное в учёбе — не сами факты, а навыки и привычка мыслить, которые остаются с тобой надолго.",
  },
  {
    author: "Альберт Эйнштейн",
    initials: "АЭ",
    slug: "einstein",
    bg: "linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)",
    image: "/img/scientists/einstein.png",
    quote:
      "Воображение важнее знания. Знание ограничено, тогда как воображение охватывает весь мир.",
    note:
      "Учёба — это не только запомнить формулы, но и научиться видеть за ними идеи и находить новые решения.",
  },
  {
    author: "Карл Саган",
    initials: "КС",
    slug: "sagan",
    bg: "linear-gradient(135deg, #581C87 0%, #7C3AED 100%)",
    quote:
      "Каждый ребёнок начинает как прирождённый учёный, а потом мы выбиваем это из него. Лишь немногие проходят через систему, сохранив удивление и энтузиазм к науке.",
    note:
      "Интерес к новому — это нормально. Важно не растерять его, готовясь к экзамену.",
  },
  {
    author: "Ричард Фейнман",
    initials: "РФ",
    slug: "feynman",
    bg: "linear-gradient(135deg, #7C2D12 0%, #EA580C 100%)",
    image: "/img/scientists/feynman.png",
    quote:
      "Первый принцип — не обманывать себя. А себя обмануть легче всего.",
    note:
      "Честно проверяй свои ответы. «Я понял» работает только тогда, когда ты можешь сам решить похожую задачу.",
  },
  {
    author: "Ричард Фейнман",
    initials: "РФ",
    slug: "feynman",
    bg: "linear-gradient(135deg, #7C2D12 0%, #EA580C 100%)",
    image: "/img/scientists/feynman.png",
    quote:
      "Я ничего не знаю, но знаю, что всё становится интересным, если вникнуть достаточно глубоко.",
    note:
      "Скучная тема часто становится увлекательной, если разобраться в ней чуть глубже, чем требует учебник.",
  },
  {
    author: "Мария Монтессори",
    initials: "ММ",
    slug: "montessori",
    bg: "linear-gradient(135deg, #831843 0%, #DB2777 100%)",
    image: "/img/scientists/montessori.png",
    quote:
      "Стимулировать жизнь, оставляя её свободной развиваться, — вот первая обязанность воспитателя.",
    note:
      "Лучший учитель не давит, а помогает учиться самому — и в твоей подготовке тоже многое зависит от тебя.",
  },
  {
    author: "Галилео Галилей",
    initials: "ГГ",
    slug: "galileo",
    bg: "linear-gradient(135deg, #064E3B 0%, #059669 100%)",
    image: "/img/scientists/galileo.png",
    quote:
      "Нельзя ничему научить человека; можно только помочь ему найти это в себе.",
    note:
      "По-настоящему понимаешь только то, до чего дошёл сам — а курсы, учителя и платформы лишь подталкивают в нужную сторону.",
  },
  {
    author: "Анри Пуанкаре",
    initials: "АП",
    slug: "poincare",
    bg: "linear-gradient(135deg, #134E4A 0%, #0D9488 100%)",
    image: "/img/scientists/poincare.png",
    quote:
      "Наука строится из фактов, как дом из камней. Но собрание фактов — ещё не наука, как куча камней — ещё не дом.",
    note:
      "Знать сто формул мало — важно понимать, как они связаны и в какой задаче пригодится каждая.",
  },
  {
    author: "Анри Пуанкаре",
    initials: "АП",
    slug: "poincare",
    bg: "linear-gradient(135deg, #134E4A 0%, #0D9488 100%)",
    image: "/img/scientists/poincare.png",
    quote:
      "Логикой мы доказываем, интуицией — открываем. Уметь критиковать хорошо, уметь создавать — лучше.",
    note:
      "Решая задачи, сначала ищи идею, а потом строго проверяй её — так работает любая хорошая математика.",
  },
  {
    author: "Стивен Хокинг",
    initials: "СХ",
    slug: "hawking",
    bg: "linear-gradient(135deg, #0F172A 0%, #475569 100%)",
    image: "/img/scientists/hawking.png",
    quote:
      "Величайшие достижения человечества стали возможны благодаря разговору, а величайшие неудачи — из-за того, что люди не разговаривали.",
    note:
      "Не понял тему — спроси. Объяснишь её другу — лучше запомнишь сам.",
  },
];

function ScientistAvatar({ q }: { q: Quote }) {
  const [imgError, setImgError] = useState(false);
  const hasImage = !!q.image && !imgError;

  return (
    <div
      className="scientist-banner__avatar"
      style={hasImage ? undefined : { background: q.bg }}
      aria-hidden
    >
      {hasImage ? (
        <img
          src={q.image}
          alt=""
          loading="lazy"
          onError={() => setImgError(true)}
          className="scientist-banner__avatar-img"
        />
      ) : (
        <span className="scientist-banner__avatar-initials">{q.initials}</span>
      )}
    </div>
  );
}

export default function ScientistQuoteBanner() {
  const quote = useMemo(
    () => QUOTES[Math.floor(Math.random() * QUOTES.length)],
    [],
  );

  return (
    <section
      className="scientist-banner"
      aria-label={`Цитата: ${quote.author}`}
    >
      <ScientistAvatar q={quote} />

      <div className="scientist-banner__body">
        <blockquote className="scientist-banner__quote">
          <p className="scientist-banner__text">{quote.quote}</p>
        </blockquote>
        <p className="scientist-banner__author">— {quote.author}</p>
        <p className="scientist-banner__note">{quote.note}</p>
      </div>
    </section>
  );
}
