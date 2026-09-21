import { Link } from "react-router-dom";
import { quotaExceededMessage } from "../storageFormat";
import "../styles/my-files.css";

export default function QuotaExceededNotice({
  message,
  quota,
  showOpenFiles = true,
  showUpgrade,
}) {
  const text = message || quotaExceededMessage(quota);
  const canUpgrade = showUpgrade !== undefined
    ? Boolean(showUpgrade)
    : Boolean(quota?.can_upgrade);

  return (
    <div className="cb-files__quota-error" role="alert">
      <p>{text}</p>
      {showOpenFiles || canUpgrade ? (
        <div className="cb-files__quota-actions">
          {showOpenFiles ? (
            <Link to="/cabinet/files" className="cb-btn cb-btn--outline cb-btn--sm">
              Открыть Мои файлы
            </Link>
          ) : null}
          {canUpgrade ? (
            <Link to="/cabinet/upgrade" className="cb-btn cb-btn--primary cb-btn--sm">
              Увеличить хранилище
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
