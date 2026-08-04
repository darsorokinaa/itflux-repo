import { createContext, useContext, useEffect, useMemo, useState } from "react";

const BRAND = "Цифровой поток";

export function formatPageTitle(title) {
  const clean = String(title || "").trim();
  if (!clean) return BRAND;
  if (clean.includes(BRAND)) return clean;
  return `${clean} — ${BRAND}`;
}

const PageTitleContext = createContext(null);

/**
 * Провайдер для layout: задаёт заголовок вкладки по умолчанию (секция)
 * и позволяет страницам переопределить его своим h1.
 */
export function PageTitleProvider({ defaultTitle, children }) {
  const [overrideTitle, setOverrideTitle] = useState(null);
  const sectionTitle = String(defaultTitle || "").trim();

  useEffect(() => {
    document.title = formatPageTitle(overrideTitle || sectionTitle || BRAND);
  }, [overrideTitle, sectionTitle]);

  const value = useMemo(
    () => ({
      setPageTitle: (title) => {
        const next = String(title || "").trim();
        setOverrideTitle(next || null);
      },
      clearPageTitle: () => setOverrideTitle(null),
    }),
    [],
  );

  return (
    <PageTitleContext.Provider value={value}>
      {children}
    </PageTitleContext.Provider>
  );
}

/** Устанавливает заголовок вкладки браузера = заголовку страницы. */
export function usePageTitle(title) {
  const ctx = useContext(PageTitleContext);

  useEffect(() => {
    const next = String(title || "").trim();
    if (!next) return undefined;

    if (ctx?.setPageTitle) {
      ctx.setPageTitle(next);
      return () => ctx.clearPageTitle();
    }

    const prev = document.title;
    document.title = formatPageTitle(next);
    return () => {
      document.title = prev;
    };
  }, [title, ctx]);
}
