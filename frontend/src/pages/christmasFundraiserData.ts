export const CHARITY_BASE = "/static-charity";
export const FUNDRAISER_PATH = "/rozhdestvenskiy-sbor";

export function charityImg(name: string): string {
  return `${CHARITY_BASE}/img/${name}`;
}

export function charityVideo(name: string): string {
  return `${CHARITY_BASE}/video/${name}`;
}

export type GalleryPhoto = {
  file: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  lazy: boolean;
};

export const HERO_SLIDES = [
  {
    file: "xmas_kin_11.jpg",
    thumb: "xmas_kin_11_sm.jpg",
    alt: "Общая фотография на выезде",
    caption: "Рождество, Кинешма",
    width: 600,
    height: 450,
  },
  {
    file: "xmas_kin_32.jpg",
    thumb: "xmas_kin_32_sm.jpg",
    alt: "Праздничный обед за длинным столом",
    caption: "Рождество, Кинешма",
    width: 337,
    height: 600,
  },
  {
    file: "xmas_kin_27.jpg",
    thumb: "xmas_kin_27_sm.jpg",
    alt: "Общая фотография на выезде",
    caption: "Рождество, Кинешма",
    width: 600,
    height: 450,
  },
  {
    file: "photo8.jpg",
    thumb: "photo8_sm.jpg",
    alt: "Ребята с подарками",
    caption: "Рождество, Иваново",
    width: 600,
    height: 450,
  },
  {
    file: "photo5.jpg",
    thumb: "photo5_sm.jpg",
    alt: "Общая фотография у ёлки с подарками",
    caption: "Рождество, Иваново",
    width: 450,
    height: 600,
  },
] as const;

const KIN_ALTS = [
  "Ребята в микроавтобусе по дороге на выезд",
  "Ребёнок смотрит в окно микроавтобуса",
  "Ребята выгружают ёлку и коробки из микроавтобуса",
  "Ребята несут коробки с подарками по снегу",
  "Ребята у микроавтобуса с сумками",
  "Зимняя дорога и заснеженные деревья",
  "На прогулке в снегу",
  "Ребята гуляют по снегу",
  "Ёлка в снегу",
  "Общая фотография на снегу",
  "Общая фотография на выезде",
  "Зимняя прогулка у беседки",
  "Игра на свежем воздухе",
  "Игра на свежем воздухе",
  "Ребята в комнате на выезде",
  "Разбираем коробки с подарками",
  "Ребята разбирают подарки",
  "Ребята вокруг коробок с подарками у ёлки",
  "Общий сбор в комнате у ёлки",
  "Занятие на полу: ребята пишут и рисуют",
  "Занятие с подарками в комнате",
  "Разбираем коробки",
  "Ребята у ёлки с подарками",
  "Ребята рассматривают подарки",
  "Ребята у ёлки",
  "Ребята с коробками подарков",
  "Общая фотография на выезде",
  "Праздник на выезде",
  "У ёлки",
  "Смотрим фильм",
  "Праздничный стол",
  "Праздничный обед за длинным столом",
  "Праздничный стол",
  "Угощения на улице",
  "Ребята на зимней прогулке",
  "Угощение на палочке",
  "Жарим угощения на огне",
] as const;

const KIN_SIZE: ReadonlyArray<readonly [number, number]> = [
  [337, 600], [337, 600], [337, 600], [337, 600], [337, 600],
  [337, 600], [337, 600], [337, 600], [450, 600], [600, 450],
  [600, 450], [600, 338], [450, 600], [600, 450], [337, 600],
  [600, 338], [450, 600], [600, 338], [600, 338], [337, 600],
  [450, 600], [450, 600], [450, 600], [450, 600], [337, 600],
  [337, 600], [600, 450], [337, 600], [450, 600], [600, 450],
  [337, 600], [337, 600], [337, 600], [450, 600], [450, 600],
  [450, 600], [450, 600],
];

export const KIN_GALLERY: GalleryPhoto[] = KIN_ALTS.map((alt, index) => {
  const n = String(index + 1).padStart(2, "0");
  const [width, height] = KIN_SIZE[index];
  return {
    file: `xmas_kin_${n}.jpg`,
    width,
    height,
    alt,
    caption: "Рождество, Кинешма",
    lazy: index >= 2,
  };
});

export const IVANOVO_GALLERY: GalleryPhoto[] = [
  { file: "photo8.jpg", width: 600, height: 450, alt: "Ребята с подарками", caption: "Рождество, Иваново", lazy: true },
  { file: "photo5.jpg", width: 450, height: 600, alt: "Общая фотография у ёлки с подарками", caption: "Рождество, Иваново", lazy: true },
  { file: "photo10.jpg", width: 600, height: 338, alt: "Ребята с подарком", caption: "Рождество, Иваново", lazy: true },
  { file: "photo3.jpg", width: 338, height: 600, alt: "Праздничный стол с пиццей", caption: "Рождество, Иваново", lazy: true },
  { file: "photo7.jpg", width: 338, height: 600, alt: "Праздничный стол", caption: "Рождество, Иваново", lazy: true },
  { file: "photo9.jpg", width: 450, height: 600, alt: "Занятие на выезде", caption: "Рождество, Иваново", lazy: true },
  { file: "photo4.jpg", width: 338, height: 600, alt: "Пакеты с подарками", caption: "Подарки", lazy: true },
];

export const FUNDRAISER_VIDEOS = [
  { file: "IMG_9797", caption: "У ёлки" },
  { file: "IMG_9798", caption: "Пакеты с подарками" },
  { file: "IMG_9799", caption: "Праздничная ёлка" },
  { file: "IMG_9796", caption: "Праздничный стол" },
  { file: "IMG_9801", caption: "Коробки с подарками" },
  { file: "IMG_9802", caption: "Собранные вещи" },
  { file: "IMG_9803", caption: "Собираем подарки" },
] as const;

export const LONG_VIDEO_URL = "https://t.me/itfluxacademy/615";
export const QR_ALT = "QR-код СБП для перевода в организацию «Мост к сердцу»";
