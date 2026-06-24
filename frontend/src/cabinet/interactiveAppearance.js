import { useEffect, useState } from "react";
import { fetchInteractiveAppearance } from "../utils/cabinetAuth";

export const FALLBACK_APPEARANCE_CATALOG = {
  backgrounds: [
    {
      id: 1,
      slug: "light-gray",
      name: "Светло-серый",
      css_background: "#E8EDF4",
      text_tone: "dark",
      is_default: true,
    },
    {
      id: 2,
      slug: "soft-blue",
      name: "Нежно-голубой",
      css_background: "linear-gradient(135deg, #DBEAFE 0%, #E0E7FF 100%)",
      text_tone: "dark",
      is_default: false,
    },
    {
      id: 3,
      slug: "soft-violet",
      name: "Лавандовый",
      css_background: "linear-gradient(135deg, #EDE9FE 0%, #F3E8FF 100%)",
      text_tone: "dark",
      is_default: false,
    },
    {
      id: 4,
      slug: "warm-sand",
      name: "Тёплый песок",
      css_background: "linear-gradient(135deg, #FEF3C7 0%, #FFEDD5 100%)",
      text_tone: "dark",
      is_default: false,
    },
    {
      id: 5,
      slug: "mint-fresh",
      name: "Мятный",
      css_background: "linear-gradient(135deg, #D1FAE5 0%, #ECFDF5 100%)",
      text_tone: "dark",
      is_default: false,
    },
    {
      id: 6,
      slug: "navy-dark",
      name: "Тёмно-синий",
      css_background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
      text_tone: "light",
      is_default: false,
    },
    {
      id: 7,
      slug: "grid-blue",
      name: "Сетка",
      css_background:
        "linear-gradient(rgba(43, 82, 245, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(43, 82, 245, 0.05) 1px, transparent 1px), #F4F7FB",
      text_tone: "dark",
      is_default: false,
    },
  ],
  card_styles: [
    {
      id: 1,
      slug: "classic",
      name: "Классика",
      css_class: "ix-cards--classic",
      description: "Белые карточки с мягкой тенью",
      is_default: true,
    },
    {
      id: 2,
      slug: "rounded",
      name: "Скруглённые",
      css_class: "ix-cards--rounded",
      description: "Больше скругления и объёма",
      is_default: false,
    },
    {
      id: 3,
      slug: "flat",
      name: "Плоские",
      css_class: "ix-cards--flat",
      description: "Рамка без тени",
      is_default: false,
    },
    {
      id: 4,
      slug: "bold",
      name: "Акцентные",
      css_class: "ix-cards--bold",
      description: "Яркая рамка и крупный текст",
      is_default: false,
    },
    {
      id: 5,
      slug: "glass",
      name: "Стекло",
      css_class: "ix-cards--glass",
      description: "Полупрозрачные карточки",
      is_default: false,
    },
    {
      id: 6,
      slug: "notebook",
      name: "Тетрадь",
      css_class: "ix-cards--notebook",
      description: "Бумажный фон с линейкой",
      is_default: false,
    },
  ],
  sound_packs: [
    {
      id: 1,
      slug: "soft",
      name: "Мягкие",
      description: "Тихие плавные звуки",
      config: {
        flip: { freq: 520, type: "sine", duration: 0.08, volume: 0.12 },
        correct: { freq: 660, type: "sine", duration: 0.14, volume: 0.16 },
        wrong: { freq: 220, type: "sine", duration: 0.18, volume: 0.14 },
        tap: { freq: 440, type: "sine", duration: 0.04, volume: 0.08 },
      },
      is_default: true,
    },
    {
      id: 2,
      slug: "crisp",
      name: "Чёткие",
      description: "Короткие клики",
      config: {
        flip: { freq: 740, type: "triangle", duration: 0.05, volume: 0.14 },
        correct: { freq: 880, type: "triangle", duration: 0.1, volume: 0.18 },
        wrong: { freq: 180, type: "triangle", duration: 0.12, volume: 0.16 },
        tap: { freq: 600, type: "triangle", duration: 0.03, volume: 0.1 },
      },
      is_default: false,
    },
    {
      id: 3,
      slug: "arcade",
      name: "Игровые",
      description: "Яркие ретро-звуки",
      config: {
        flip: { freq: 420, type: "square", duration: 0.06, volume: 0.1 },
        correct: { freq: 784, type: "square", duration: 0.12, volume: 0.14 },
        wrong: { freq: 160, type: "square", duration: 0.2, volume: 0.12 },
        tap: { freq: 520, type: "square", duration: 0.04, volume: 0.09 },
      },
      is_default: false,
    },
    {
      id: 4,
      slug: "silent",
      name: "Без звука",
      description: "Звуковые эффекты отключены",
      config: {},
      is_default: false,
    },
  ],
};

export const DEFAULT_APPEARANCE = {
  backgroundSlug: "light-gray",
  cardStyleSlug: "classic",
  soundPackSlug: "soft",
  soundEnabled: true,
  backgroundImage: null,
  backgroundImageTone: "light",
};

let catalogCache = null;
let catalogPromise = null;

export function loadAppearanceCatalog({ force = false } = {}) {
  if (!force && catalogCache) return Promise.resolve(catalogCache);
  if (!force && catalogPromise) return catalogPromise;

  catalogPromise = fetchInteractiveAppearance()
    .then((data) => {
      catalogCache = data;
      return data;
    })
    .catch(() => {
      catalogCache = FALLBACK_APPEARANCE_CATALOG;
      return catalogCache;
    })
    .finally(() => {
      catalogPromise = null;
    });

  return catalogPromise;
}

export function getCachedAppearanceCatalog() {
  return catalogCache || FALLBACK_APPEARANCE_CATALOG;
}

function pickBySlug(list, slug, fallbackKey = "is_default") {
  if (!list?.length) return null;
  if (slug) {
    const found = list.find((item) => item.slug === slug);
    if (found) return found;
  }
  return list.find((item) => item[fallbackKey]) || list[0];
}

export function resolveInteractiveAppearance(interactive, catalog = getCachedAppearanceCatalog()) {
  const background = pickBySlug(
    catalog.backgrounds,
    interactive?.backgroundSlug,
  );
  const cardStyle = pickBySlug(
    catalog.card_styles,
    interactive?.cardStyleSlug,
  );
  const soundPack = pickBySlug(
    catalog.sound_packs,
    interactive?.soundPackSlug,
  );
  const customBackgroundImage = interactive?.backgroundImage || null;
  const backgroundImageTone = interactive?.backgroundImageTone || "light";

  return {
    background,
    cardStyle,
    soundPack,
    soundEnabled: interactive?.soundEnabled !== false && soundPack?.slug !== "silent",
    customBackgroundImage,
    backgroundImageTone,
  };
}

export function useInteractiveAppearanceCatalog() {
  const [catalog, setCatalog] = useState(() => getCachedAppearanceCatalog());
  const [loading, setLoading] = useState(!catalogCache);

  useEffect(() => {
    let active = true;
    loadAppearanceCatalog().then((data) => {
      if (active) {
        setCatalog(data);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return { catalog, loading };
}

export function interactiveMediaUrl(url) {
  if (!url) return null;
  const idx = url.indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

export function backgroundImageStyle(imageUrl, textTone = "dark") {
  const src = interactiveMediaUrl(imageUrl);
  if (!src) return null;
  const overlay = textTone === "light"
    ? "rgba(15, 23, 42, 0.5)"
    : "rgba(255, 255, 255, 0.35)";
  return {
    backgroundImage: `linear-gradient(${overlay}, ${overlay}), url("${src}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

export function appearancePageStyle(appearance) {
  if (appearance?.customBackgroundImage) {
    return backgroundImageStyle(
      appearance.customBackgroundImage,
      appearance.backgroundImageTone === "light" ? "light" : "dark",
    );
  }
  if (appearance?.background?.background_image_url) {
    return backgroundImageStyle(
      appearance.background.background_image_url,
      appearance.background.text_tone === "light" ? "light" : "dark",
    );
  }
  if (!appearance?.background) return undefined;
  const bg = appearance.background.css_background;
  if (appearance.background.slug === "grid-blue") {
    return {
      background: bg,
      backgroundSize: "32px 32px, 32px 32px, auto",
    };
  }
  return { background: bg };
}

export function appearancePageClass(appearance) {
  const tone = appearance?.customBackgroundImage
    ? (appearance.backgroundImageTone === "light" ? "light" : "dark")
    : appearance?.background?.background_image_url
      ? (appearance.background.text_tone === "light" ? "light" : "dark")
      : (appearance?.background?.text_tone === "light" ? "light" : "dark");
  const cardClass = appearance?.cardStyle?.css_class || "ix-cards--classic";
  return [`ix-tone--${tone}`, cardClass].filter(Boolean).join(" ");
}

const MAX_BG_IMAGE_BYTES = 900_000;
const MAX_BG_IMAGE_SIDE = 1600;

export function compressBackgroundImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("Выберите файл изображения"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Некорректное изображение"));
      img.onload = () => {
        const scale = Math.min(1, MAX_BG_IMAGE_SIDE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.88;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > MAX_BG_IMAGE_BYTES && quality > 0.4) {
          quality -= 0.08;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        if (dataUrl.length > MAX_BG_IMAGE_BYTES) {
          reject(new Error("Изображение слишком большое. Попробуйте файл меньшего размера."));
          return;
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
