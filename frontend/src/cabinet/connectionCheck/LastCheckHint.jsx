import { useEffect, useState } from "react";
import {
  CONNECTION_CHECK_RESULT_EVENT,
  formatCheckedAt,
  isConnectionCheckFresh,
  readConnectionCheckResult,
} from "./storage";
import "./connectionCheck.css";

export default function LastCheckHint() {
  const [result, setResult] = useState(() => readConnectionCheckResult());

  useEffect(() => {
    const sync = () => setResult(readConnectionCheckResult());
    window.addEventListener(CONNECTION_CHECK_RESULT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CONNECTION_CHECK_RESULT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!isConnectionCheckFresh(result) || !result?.checked_at) return null;
  return (
    <p className="cc-checked">
      Связь проверена сегодня в {formatCheckedAt(result.checked_at)} ✓
    </p>
  );
}
