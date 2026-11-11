import { useState } from "react";

export default function CatalogPromoBox({
  onQuote,
  onApplied,
  disabled = false,
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState("");

  const apply = async () => {
    const next = code.trim();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await onQuote(next);
      const text = data?.message || data?.pricing?.message || "";
      if (next && !text && data?.pricing?.applied_discount_source === "none") {
        setError("Промокод не изменил цену.");
        setApplied("");
        onApplied?.("");
      } else {
        setMessage(text || (next ? "Промокод принят." : ""));
        setApplied(next);
        onApplied?.(next);
      }
    } catch (err) {
      setApplied("");
      onApplied?.("");
      setError(err?.message || "Не удалось применить промокод");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="catalog-promo">
      <div className="catalog-promo__row">
        <input
          className="catalog-promo__input"
          value={code}
          placeholder="Промокод"
          aria-label="Промокод"
          disabled={disabled || busy}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
        <button type="button" className="catalog-promo__btn" onClick={apply} disabled={disabled || busy || !code.trim()}>
          {busy ? "…" : "Применить"}
        </button>
      </div>
      {message ? <p className="catalog-promo__msg catalog-promo__msg--ok">{message}</p> : null}
      {error ? <p className="catalog-promo__msg catalog-promo__msg--err" role="alert">{error}</p> : null}
      <span className="catalog-promo__applied" hidden>{applied}</span>
    </div>
  );
}
