import { useEffect, useState } from "react";

export default function MessagingAgreementPage() {
  const [agreement, setAgreement] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cabinet/messages/agreement/", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Не удалось открыть соглашение");
        return res.json();
      })
      .then((data) => { if (!cancelled) setAgreement(data); })
      .catch((err) => { if (!cancelled) setError(err.message || "Не удалось открыть соглашение"); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="privacy-page">
      <div className="privacy-container">
        <h1 className="privacy-title">{agreement?.title || "Соглашение об использовании сообщений"}</h1>
        <p className="privacy-updated">{agreement?.updated ? `Дата редакции: ${agreement.updated}` : "Загрузка…"}</p>
        {error ? <p className="privacy-intro">{error}</p> : null}
        {(agreement?.body || "").split(/\n\n+/).filter(Boolean).map((paragraph) => (
          <p className="privacy-intro" key={paragraph.slice(0, 32)}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}
