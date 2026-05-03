const THEME_DATA_KEY = "theme_data";
const THEME_ID_KEY = "active_theme_id";
/** Локальный календарный день сохранения (YYYY-MM-DD); при другом дне тема сбрасывается. */
const THEME_DAY_KEY = "theme_valid_day";

export function localThemeCalendarDay() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clearAll() {
  try {
    localStorage.removeItem(THEME_DATA_KEY);
    localStorage.removeItem(THEME_ID_KEY);
    localStorage.removeItem(THEME_DAY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Читает тему из localStorage. Если сохранена не на сегодня (локальный день) — очищает и возвращает пусто.
 */
export function readPersistedTheme() {
  try {
    const today = localThemeCalendarDay();
    const savedDay = localStorage.getItem(THEME_DAY_KEY);
    if (savedDay && savedDay !== today) {
      clearAll();
      return { themeData: null, activeThemeId: null };
    }

    if (!savedDay) {
      if (localStorage.getItem(THEME_DATA_KEY) || localStorage.getItem(THEME_ID_KEY)) {
        clearAll();
      }
      try {
        const rawS = sessionStorage.getItem("theme_data");
        const sid = sessionStorage.getItem("active_theme_id");
        if (rawS && sid) {
          const themeData = JSON.parse(rawS);
          writePersistedTheme(themeData, sid);
          sessionStorage.removeItem("theme_data");
          sessionStorage.removeItem("active_theme_id");
          return { themeData, activeThemeId: sid };
        }
      } catch {
        /* ignore */
      }
      return { themeData: null, activeThemeId: null };
    }

    const raw = localStorage.getItem(THEME_DATA_KEY);
    const themeData = raw ? JSON.parse(raw) : null;
    const activeThemeId = localStorage.getItem(THEME_ID_KEY) || null;
    return { themeData, activeThemeId };
  } catch {
    return { themeData: null, activeThemeId: null };
  }
}

export function writePersistedTheme(themeData, activeThemeId) {
  try {
    localStorage.setItem(THEME_DAY_KEY, localThemeCalendarDay());
    localStorage.setItem(THEME_DATA_KEY, JSON.stringify(themeData));
    localStorage.setItem(THEME_ID_KEY, String(activeThemeId));
  } catch {
    /* приватный режим и т.п. */
  }
}

export function clearPersistedTheme() {
  clearAll();
}
