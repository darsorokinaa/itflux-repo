import punycode from "punycode";

/**
 * Браузер отдаёт IDN-хост в Punycode (xn--…); для копирования ссылки нужен читаемый домен.
 * Опционально: VITE_PUBLIC_SITE_ORIGIN=http://генурок.рф — канонический origin при сборке.
 */
function hostnameToUnicode(hostname) {
  if (!hostname) return hostname;
  return hostname
    .split(".")
    .map((label) => {
      if (/^xn--/i.test(label)) {
        try {
          return punycode.toUnicode(label);
        } catch {
          return label;
        }
      }
      return label;
    })
    .join(".");
}

export function getShareablePageUrl() {
  const raw = import.meta.env.VITE_PUBLIC_SITE_ORIGIN;
  if (raw && String(raw).trim().startsWith("http")) {
    const base = String(raw).replace(/\/$/, "");
    return `${base}${window.location.pathname}${window.location.search}${window.location.hash}`;
  }
  const { protocol, hostname, port, pathname, search, hash } = window.location;
  const host = hostnameToUnicode(hostname);
  const portPart = port ? `:${port}` : "";
  return `${protocol}//${host}${portPart}${pathname}${search}${hash}`;
}
