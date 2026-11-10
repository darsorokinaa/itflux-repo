import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import FundraiserCollected from "../components/FundraiserCollected";
import {
  charityImg,
  charityVideo,
  FUNDRAISER_VIDEOS,
  HERO_SLIDES,
  IVANOVO_GALLERY,
  KIN_GALLERY,
  LONG_VIDEO_URL,
  QR_ALT,
  type GalleryPhoto,
} from "./christmasFundraiserData";
import { useFundraiserSnapshot } from "./fundraiserAmount";
import "./christmas-fundraiser.css";

type LightItem = { full: string; alt: string; caption: string };

const PAGE_TITLE = "🎄 Рождественский сбор — Цифровой поток";

function Photo({
  photo,
  onOpen,
}: {
  photo: GalleryPhoto;
  onOpen: () => void;
}) {
  return (
    <figure>
      <img
        src={charityImg(photo.file.replace(/\.jpg$/, "_sm.jpg"))}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        loading={photo.lazy ? "lazy" : undefined}
        decoding="async"
        onClick={onOpen}
      />
      <figcaption>{photo.caption}</figcaption>
    </figure>
  );
}

export default function ChristmasFundraiserPage() {
  const snapshot = useFundraiserSnapshot();
  const { hash } = useLocation();
  const activeHash = hash || "#sbor";
  const [heroIndex, setHeroIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lightIndex, setLightIndex] = useState<number | null>(null);
  const [showStickyHelp, setShowStickyHelp] = useState(false);
  const hero = HERO_SLIDES[heroIndex];

  const lightItems = useMemo<LightItem[]>(() => {
    const photos: LightItem[] = [
      { full: charityImg(hero.file), alt: hero.alt, caption: hero.caption },
      {
        full: charityImg("poster_header.jpg"),
        alt: "Сбор рождественских подарков для детей из детских домов и учреждений социальной защиты, Иваново и Ивановская область",
        caption: "Сбор рождественских подарков, Иваново и Ивановская область",
      },
      {
        full: charityImg("photo2.jpg"),
        alt: "Что можно положить в новогодний подарок: книги, творчество, тёплые вещи, гигиена, канцелярия и сладости",
        caption: "Подробный список, что можно положить в подарок",
      },
      {
        full: charityImg("photo3.jpg"),
        alt: "Праздничный стол с пиццей",
        caption: "Праздничный стол",
      },
      {
        full: charityImg("photo5.jpg"),
        alt: "Общая фотография у ёлки с подарками",
        caption: "У ёлки",
      },
      ...KIN_GALLERY.map((photo) => ({
        full: charityImg(photo.file),
        alt: photo.alt,
        caption: photo.caption,
      })),
      ...IVANOVO_GALLERY.map((photo) => ({
        full: charityImg(photo.file),
        alt: photo.alt,
        caption: photo.caption,
      })),
    ];
    return photos;
  }, [hero]);

  useEffect(() => {
    const previous = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    const card = document.getElementById("sbor-card");
    if (!card || typeof IntersectionObserver === "undefined") {
      setShowStickyHelp(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyHelp(!entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const applyDock = () => {
      const cookie = document.querySelector(".cookie-banner");
      const tab = document.querySelector(".mobile-tabbar");
      const heightOf = (node: Element | null) => {
        if (!node) return 0;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return 0;
        return Math.ceil(node.getBoundingClientRect().height);
      };
      const offset = Math.max(heightOf(cookie), heightOf(tab));
      document.documentElement.style.setProperty("--xmas-dock-bottom", `${offset}px`);
    };
    applyDock();
    const observer = new MutationObserver(applyDock);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", applyDock);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", applyDock);
    };
  }, []);

  useEffect(() => {
    const header = document.querySelector(".site-header");
    if (!header) return undefined;
    const apply = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--xmas-stick-top", `${height + 8}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  useEffect(() => {
    if (!helpOpen && lightIndex == null) {
      document.body.style.overflow = "";
      return undefined;
    }
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        setLightIndex(null);
      } else if (lightIndex != null && event.key === "ArrowRight") {
        setLightIndex((index) => (index == null ? index : (index + 1) % lightItems.length));
      } else if (lightIndex != null && event.key === "ArrowLeft") {
        setLightIndex((index) => (index == null ? index : (index - 1 + lightItems.length) % lightItems.length));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [helpOpen, lightIndex, lightItems.length]);

  const openAt = (index: number) => setLightIndex(index);
  const current = lightIndex == null ? null : lightItems[lightIndex];
  const touchX = useRef(0);

  return (
    <div className="xmas-page">
      <div className="xmas-hero">
        <img
          className="xmas-hero__main"
          src={charityImg(hero.file)}
          alt={hero.alt}
          width={1600}
          height={1200}
          onClick={() => openAt(0)}
        />
        <div className="xmas-hero__thumbs" aria-label="Другие фото">
          {HERO_SLIDES.map((slide, index) => (
            <button
              key={slide.file}
              type="button"
              className={index === heroIndex ? "is-on" : undefined}
              onClick={() => setHeroIndex(index)}
            >
              <img src={charityImg(slide.thumb)} alt="" width={slide.width} height={slide.height} />
            </button>
          ))}
        </div>
      </div>

      <header className="xmas-head">
        <h1>🎄&nbsp;Рождественский сбор</h1>
        <p className="xmas-subtitle">Для детей из детских домов и учреждений социальной защиты города Иваново и Ивановской области.</p>
      </header>

      <aside className="xmas-fund" id="sbor-card">
        <FundraiserCollected snapshot={snapshot} />
        <button type="button" className="xmas-btn xmas-btn--primary" onClick={() => setHelpOpen(true)}>Помочь</button>
        <img className="xmas-fund__qr" src={charityImg("qr.png")} alt={QR_ALT} />
        <p className="xmas-fund__note">QR-код СБП. Наведите камеру телефона.</p>
        <a className="xmas-btn xmas-btn--ghost" href="https://vk.ru/donut/itfluxacademy">Донат ВКонтакте</a>

        <div className="xmas-organizer">
          <p className="xmas-organizer__h">Организатор</p>
          <div className="xmas-org">
            <img src={charityImg("darya.jpg")} alt="Дарья Сорокина" />
            <div>
              <p className="xmas-org__name">Дарья Сорокина</p>
              <p className="xmas-org__bio">Преподаватель математики и информатики, разработчик и основатель платформы «Цифровой поток».</p>
              <div className="xmas-rating">5,0 · 11 отзывов</div>
              <a className="xmas-org__link" href="https://profi.ru/profile/SorokinaDV3/">Мой профиль и отзывы на Профи.ру</a>
            </div>
          </div>
          <ul className="xmas-contacts">
            <li>Telegram: <a href="https://t.me/dariyasorokinaa">@dariyasorokinaa</a></li>
            <li>MAX: <a href="https://max.ru/channel_itfluxacademy">канал «Цифровой поток»</a></li>
            <li>Почта: <a href="mailto:itflux.academy@yandex.ru">itflux.academy@yandex.ru</a></li>
            <li>На платформе: <a href="https://itflux.ru/cabinet/messages">сообщения в кабинете</a></li>
          </ul>
        </div>
      </aside>

      <nav className="xmas-tabs" aria-label="Разделы страницы">
        <a href="#sbor" className={activeHash === "#sbor" ? "is-active" : undefined}>О сборе</a>
        <a href="#otchyoty" className={activeHash === "#otchyoty" ? "is-active" : undefined}>Отчёты</a>
        <a href="#foto-video" className={activeHash === "#foto-video" ? "is-active" : undefined}>Фото и видео</a>
      </nav>

      <article className="xmas-story">
        <h2 id="sbor">О сборе</h2>
        <p>Есть дела, которые не про уроки и задания, но так же важны для меня, как и сама платформа.</p>
        <p>Вместе с организацией «<a href="https://t.me/most_k_serdcu">Мост к сердцу</a>» я уже много лет езжу к ребятам из детских домов и учреждений социальной защиты в Иванове и Ивановской области. Эта большая любовь живёт в моём сердце уже восемь лет.</p>
        <p>Мы стараемся приезжать к ребятам каждый месяц: устраиваем праздники, проводим время вместе, играем, общаемся и просто стараемся подарить немного тепла и внимания. Рождество и Новый год — особенное время. Каждый год мы готовим рождественские и новогодние подарки и собираем их более ста.</p>
        <p>«<a href="https://t.me/most_k_serdcu">Мост к сердцу</a>» на протяжении многих лет навещает ребят из детских домов и детей, находящихся под опекой социальной защиты, и старается быть для них поддержкой, чтобы дети, которым в жизни пришлось столкнуться с трудностями, могли почувствовать себя чуть менее одинокими.</p>
        <p>С 9 ноября 2026 года и до нашей рождественской поездки все средства от подписок на «Цифровой поток» я направляю на организацию праздничных мероприятий и покупку подарков для детей из детских домов и учреждений социальной защиты.</p>

        <h3>Рождественский сбор 2026</h3>
        <p>Впереди у нас очередная рождественская поездка. Нам снова предстоит подготовить более 100 подарков, организовать праздничные мероприятия и сделать всё возможное, чтобы эти дни оставили у детей добрые и тёплые воспоминания.</p>
        <p>Сбор — для детей из детских домов и учреждений социальной защиты города Иваново и Ивановской области.</p>
        <img
          className="xmas-flyer"
          src={charityImg("poster_header.jpg")}
          alt="Сбор рождественских подарков для детей из детских домов и учреждений социальной защиты, Иваново и Ивановская область"
          onClick={() => openAt(1)}
        />
        <p className="xmas-cap">Сбор рождественских подарков, Иваново и Ивановская область</p>

        <h3>Что можно подарить</h3>
        <ul>
          <li>развивающие и настольные игры;</li>
          <li>книги — художественные и познавательные;</li>
          <li>наборы для творчества: рисование, лепка, поделки;</li>
          <li>тёплые вещи: шапки, варежки, шарфы;</li>
          <li>сладкие подарки в заводской упаковке.</li>
        </ul>
        <p>Подойдут и новые вещи, и средства личной гигиены, и уже готовые подарки. Если удобнее заказать всё на маркетплейсе, это тоже помощь.</p>
        <img
          className="xmas-flyer"
          src={charityImg("photo2.jpg")}
          alt="Что можно положить в новогодний подарок: книги, творчество, тёплые вещи, гигиена, канцелярия и сладости"
          onClick={() => openAt(2)}
        />
        <p className="xmas-cap">Подробный список, что можно положить в подарок</p>

        <h3 id="kak-pomoch">Как помочь</h3>
        <ul>
          <li><strong>Переводом по QR-коду.</strong> Наведите камеру на код в карточке сбора — это QR-код СБП для перевода в организацию «Мост к сердцу».</li>
          <li><strong>Донатом ВКонтакте.</strong> Можно отправить <a href="https://vk.ru/donut/itfluxacademy">донат на любую комфортную сумму</a>.</li>
          <li><strong>Подпиской на платформу.</strong> В период сбора средства от подписок на «Цифровой поток» я направляю на поездку и подарки.</li>
          <li><strong>Подарками.</strong> Передать новые вещи, средства гигиены и другие нужные подарки или заказать их на маркетплейсах. Если нужно уточнить, куда отправить заказ, напишите мне.</li>
          <li><strong>Рассказом.</strong> Поделитесь этой страницей или <a href={LONG_VIDEO_URL}>моим постом о сборе</a>. Иногда именно так о сборе узнаёт человек, который захочет помочь.</li>
        </ul>
        <p>Каждому, кто поддержит сбор донатом или пожертвованием, я открою полный бесплатный доступ к платформе «Цифровой поток» на две недели. Сумма может быть любой. После пожертвования напишите мне — в <a href="https://t.me/dariyasorokinaa">Telegram</a>, в <a href="https://max.ru/channel_itfluxacademy">канале «Цифровой поток» в MAX</a>, на почту <a href="mailto:itflux.academy@yandex.ru">itflux.academy@yandex.ru</a> или <a href="https://itflux.ru/cabinet/messages">в сообщениях на платформе</a> — и я открою доступ.</p>
        <p>Небольшая сумма тоже имеет значение. Когда много людей делают пусть даже совсем немного, вместе получается что-то по-настоящему большое.</p>
        <p>Следить за поездками организации можно в её <a href="https://t.me/most_k_serdcu">телеграм-канале</a> и <a href="https://vk.ru/most_k_serdcu">группе ВКонтакте</a>.</p>

        <h2 id="otchyoty">Отчёты</h2>
        <p>Ниже — поездки, о которых я рассказывала в своём канале. У каждой есть ссылка на отчёт в канале «Мост к сердцу». Больше фото и видео — <a href="https://vk.ru/most_k_serdcu">во ВКонтакте у организации</a>.</p>

        <div className="xmas-year">2024</div>
        <div className="xmas-tl">
          <article className="xmas-tl__item">
            <h3>Летний выезд детского дома «Радуга», г. Иваново</h3>
            <p>Старшие воспитанники провели туристический выезд, организованный «Мостом к сердцу». Ребята занимались спортом и творчеством, общались и проводили время на природе, а потом делились впечатлениями.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/4">Отчёт</a></p>
          </article>
          <article className="xmas-tl__item">
            <h3>Рождество 2024</h3>
            <p>В преддверии праздников мы приезжали к ребятам с играми, квестом, праздничным столом и подарками: вместе ели пиццу, фрукты и даже мороженое, делились хорошими событиями за год. Перед Рождеством мы посетили Васильевский детский дом в селе Васильевское, детский дом «Ровесник» и детский дом «Радуга» в Иванове.</p>
            <img className="xmas-tl__photo" src={charityImg("photo3.jpg")} alt="Праздничный стол с пиццей" onClick={() => openAt(3)} />
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/130">Ролик</a> · <a href="https://t.me/most_k_serdcu/115">Фотоотчёт</a></p>
          </article>
          <article className="xmas-tl__item">
            <h3>Рождественский выезд для детского дома г. Кинешмы</h3>
            <p>В январе в деревне Большое Кстово прошёл выезд. Ребята гуляли, играли в лазертаг и настольные игры, встречали Деда Мороза и Снегурочку, получали подарки и говорили о Рождестве. После программы они сказали, что хотели бы приехать снова.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/138">Отчёт</a></p>
          </article>
        </div>

        <div className="xmas-year">2025</div>
        <div className="xmas-tl">
          <article className="xmas-tl__item">
            <h3>Весенний выезд для детского дома «Ровесник»</h3>
            <p>В мае воспитанники детского дома «Ровесник» г. Иваново приехали в деревню Большое Кстово. Были лазертаг и мастер-классы, в том числе по раскрашиванию футболок. Ребята отдыхали на свежем воздухе, разговаривали у костра и в конце вручили деревне скворечник, сделанный своими руками.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/205">Отчёт</a></p>
          </article>
          <article className="xmas-tl__item">
            <h3>Летний выезд для детского дома села Васильевское</h3>
            <p>Ребята приехали в деревню: утро началось с блинчиков, потом был мастер-класс — каждый раскрасил себе футболку и шопер, — игры, вода, квест и разговор о картине «Воздвижение Креста» Питера Пауля Рубенса.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/258">Отчёт</a></p>
          </article>
          <article className="xmas-tl__item">
            <h3>Летний пикник для детского дома г. Кинешмы</h3>
            <p>В конце лета, перед началом учебного года, мы встретились с ребятами кинешемского детского дома: шашлык, игры, разговоры и подарки.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/278">Отчёт</a></p>
          </article>
          <article className="xmas-tl__item">
            <h3>Осенний выезд детского дома «Радуга», ноябрь 2025</h3>
            <p>Для ребят из «Радуги» г. Иваново мы устроили квест с поиском сокровищ, верёвочную дорогу между деревьями, игры на свежем воздухе, шуточные настольные игры, песни и зефир у костра, танцы и фильм вечером. Кормили домашним обедом: шашлыком, супами и пловом.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/295">Отчёт</a></p>
          </article>
          <article className="xmas-tl__item">
            <h3>Рождество 2025</h3>
            <p>Перед Рождеством мы посетили сразу четыре детских дома: Шуйский детский дом-школу, Васильевский детский дом, ивановские «Радугу» и «Ровесник». С детьми были Дед Мороз, Снегурочка и Снеговик, конкурсы, игры и танцы. Вместе ели пиццу и мандарины, говорили о Рождестве. Ребята из Васильевского детского дома показали спектакль по мотивам «Простоквашино». В конце праздника каждый ребёнок получил именной подарок. Благодаря неравнодушным людям подарки собрали почти для ста детей из пяти детских домов.</p>
            <img className="xmas-tl__photo" src={charityImg("photo5.jpg")} alt="Общая фотография у ёлки с подарками" onClick={() => openAt(4)} />
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/331">Часть 1</a> · <a href="https://t.me/most_k_serdcu/341">Часть 2, видео</a></p>
          </article>
        </div>

        <div className="xmas-year">2026</div>
        <div className="xmas-tl">
          <article className="xmas-tl__item">
            <h3>«Кругосветка» с «Радугой» и ребятами из соцзащиты, июль</h3>
            <p>Программа была построена как путешествие по странам. На свежем воздухе мы играли в командные игры, собирали алмазную мозаику, играли в футбол и волейбол, устроили праздник с красками холи и обливаниями. Была встреча про жизнь и традиции Южной Кореи, а в «путешествии по России» вместе рассматривали картину Александра Иванова «Явление Христа народу». Об этом дне я написала и в своём канале: несмотря на ссоры, упрямство, отсутствие интернета и опоздание на поезд из-за перекрытых дорог, всё сложилось — дети, команда, погода, песни и смех.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/388">Отчёт</a> · <a href="https://t.me/itfluxacademy/343">Мой пост</a></p>
          </article>
          <article className="xmas-tl__item">
            <h3>«Кругосветка» с «Ровесником», август</h3>
            <p>Ребята из детского дома «Ровесник» г. Иваново отправились «путешествовать по миру»: у каждого были паспорт путешественника, билет и браслет команды. В Греции мы устроили свои Олимпийские игры, в Китае переносили предметы палочками, в Бразилии разучивали танцы, на Гавайях готовили фруктовые коктейли, в Мексике разбивали пиньяту. Были мастер-классы по русским народным промыслам и брелокам, футбол, волейбол, поиск сокровищ, квиз по странам мира и краски холи. Я тоже рассказала об этом дне: искали жёлтых уточек, готовили коктейли, играли в квиз, били пиньяту, играли с красками холи и устраивали водяную битву.</p>
            <p className="xmas-links"><a href="https://t.me/most_k_serdcu/390">Отчёт</a> · <a href="https://t.me/itfluxacademy/426">Мой пост</a></p>
          </article>
        </div>
        <p>Полный список этих поездок со ссылками я публиковала и в своём канале — <a href="https://t.me/itfluxacademy/617">пост от 9 ноября 2026 года</a>.</p>

        <h2 id="foto-video">Фото и видео</h2>
        <div className="xmas-gallery-block">
          <h3>Рождество, Кинешма</h3>
          <div className="xmas-gallery">
            {KIN_GALLERY.map((photo, index) => (
              <Photo key={photo.file} photo={photo} onOpen={() => openAt(5 + index)} />
            ))}
          </div>
        </div>
        <div className="xmas-gallery-block">
          <h3>Рождество, Иваново</h3>
          <div className="xmas-gallery">
            {IVANOVO_GALLERY.map((photo, index) => (
              <Photo key={photo.file} photo={photo} onOpen={() => openAt(5 + KIN_GALLERY.length + index)} />
            ))}
          </div>
        </div>

        <p>Кадры с рождественских выездов в Кинешму — из <a href="https://vk.ru/most_k_serdcu">группы «Мост к сердцу»</a>. Фото из Иванова и с подготовки подарков — из <a href={LONG_VIDEO_URL}>моего поста о сборе</a>.</p>
        <div className="xmas-videos">
          {FUNDRAISER_VIDEOS.map((video) => (
            <figure className="xmas-video" key={video.file}>
              <video
                controls
                playsInline
                preload="metadata"
                poster={charityVideo(`${video.file}.jpg`)}
                src={charityVideo(`${video.file}.mp4`)}
                width={720}
                height={1280}
              />
              <figcaption>{video.caption}</figcaption>
            </figure>
          ))}
        </div>
        <p className="xmas-video-note">Ещё один, более длинный ролик можно открыть в <a href={LONG_VIDEO_URL}>посте о сборе</a>.</p>

        <h3>Мои страницы</h3>
        <div className="xmas-links-block">
          <a href="https://t.me/itfluxacademy">Telegram</a>
          <a href="https://vk.ru/itfluxacademy">ВКонтакте</a>
          <a href="https://max.ru/channel_itfluxacademy">MAX</a>
          <a href="https://t.me/most_k_serdcu">«Мост к сердцу» в Telegram</a>
          <a href="https://vk.ru/most_k_serdcu">«Мост к сердцу» во ВКонтакте</a>
          <a href="https://vk.ru/donut/itfluxacademy">Донат ВКонтакте</a>
        </div>
      </article>

      {showStickyHelp && lightIndex == null && !helpOpen ? (
        <div className="xmas-sticky-help">
          <button type="button" className="xmas-btn xmas-btn--primary" onClick={() => setHelpOpen(true)}>Помочь</button>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="xmas-modal is-open" role="dialog" aria-label="Помочь сбору" onClick={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <div className="xmas-modal__card">
            <button type="button" className="xmas-modal__close" aria-label="Закрыть" onClick={() => setHelpOpen(false)}>×</button>
            <h2>Помочь сбору</h2>
            <img src={charityImg("qr.png")} alt={QR_ALT} />
            <p>Наведите камеру на код — это QR-код СБП для перевода в организацию «Мост к сердцу». Больше ничего вводить не нужно.</p>
            <a className="xmas-btn xmas-btn--ghost" href="https://vk.ru/donut/itfluxacademy">Донат ВКонтакте</a>
          </div>
        </div>
      ) : null}

      {current ? (
        <div
          className="xmas-lightbox is-open"
          role="dialog"
          aria-label="Просмотр фото"
          onClick={(event) => { if (event.target === event.currentTarget) setLightIndex(null); }}
          onTouchStart={(event) => { touchX.current = event.changedTouches[0].screenX; }}
          onTouchEnd={(event) => {
            const dx = event.changedTouches[0].screenX - touchX.current;
            if (dx > 50) setLightIndex((index) => (index == null ? index : (index - 1 + lightItems.length) % lightItems.length));
            else if (dx < -50) setLightIndex((index) => (index == null ? index : (index + 1) % lightItems.length));
          }}
        >
          <button type="button" className="xmas-lightbox__close" aria-label="Закрыть" onClick={() => setLightIndex(null)}>×</button>
          <button type="button" className="xmas-lightbox__btn xmas-lightbox__btn--prev" aria-label="Предыдущее фото" onClick={(event) => { event.stopPropagation(); setLightIndex((index) => (index == null ? index : (index - 1 + lightItems.length) % lightItems.length)); }}>‹</button>
          <img src={current.full} alt={current.alt} />
          <button type="button" className="xmas-lightbox__btn xmas-lightbox__btn--next" aria-label="Следующее фото" onClick={(event) => { event.stopPropagation(); setLightIndex((index) => (index == null ? index : (index + 1) % lightItems.length)); }}>›</button>
          <div className="xmas-lightbox__cap">{current.caption}</div>
        </div>
      ) : null}
    </div>
  );
}
