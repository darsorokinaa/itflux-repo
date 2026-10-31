import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchCabinetSession, joinVariantLiveSession } from "../../utils/cabinetAuth";
import { joinErrorText } from "../liveSolve";
import "../styles/live-solve.css";

/** r125: ученик открывает ссылку «Решать вариант» → вход → вариант. */
export default function VariantLiveJoinPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      const session = await fetchCabinetSession({ fresh: true }).catch(() => ({ authenticated: false }));
      if (!session?.authenticated) {
        navigate(`/cabinet/login?next=${encodeURIComponent(`/variant-live/${sessionId}`)}`, { replace: true });
        return;
      }
      try {
        const data = await joinVariantLiveSession(sessionId);
        if (!cancel && data?.openUrl) window.location.replace(data.openUrl);
      } catch (err) {
        if (!cancel) setError(joinErrorText(err));
      }
    })();
    return () => { cancel = true; };
  }, [sessionId, navigate]);

  return (
    <main className="ls-join">
      {!error ? <p>Подключаемся к варианту…</p> : (
        <section>
          <h1>Не получилось открыть вариант</h1>
          <p>{error}</p>
          <a href="/cabinet">Перейти в кабинет</a>
        </section>
      )}
    </main>
  );
}
