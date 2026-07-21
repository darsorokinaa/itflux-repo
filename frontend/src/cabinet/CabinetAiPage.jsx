// TEMP: ИИ-помощник скрыт — весь интерфейс закомментирован.
// Чтобы вернуть: раскомментировать ниже, а также пункты в cabinetNav.js и маршрут в App.jsx.

export default function CabinetAiPage() {
  return null;
}

/*
import { useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "./CabinetIcons";
import {
  CabinetPageShell,
  CabinetPageHeader,
} from "./CabinetSectionUi";
import LimitBadge from "./components/LimitBadge";
import UpgradeLimitModal from "./components/UpgradeLimitModal";
import CompactUpgradeModal from "./components/CompactUpgradeModal";
import { useSubscription } from "./hooks/useSubscription";
import { useLimitModal } from "./hooks/useLimitModal";
import { sendAIRequest } from "../utils/cabinetAuth";

const REQUEST_TYPES = [
  { id: "explain", label: "Объяснить тему", cost: 1 },
  { id: "generate_task", label: "Задание по теме", cost: 2 },
  { id: "generate_set", label: "Набор заданий", cost: 3 },
  { id: "comment", label: "Комментарий ученику", cost: 1 },
  { id: "idea", label: "Идея урока", cost: 1 },
  { id: "feedback", label: "Обратная связь", cost: 2 },
];

export default function CabinetAiPage() {
  const [prompt, setPrompt] = useState("");
  const [requestType, setRequestType] = useState("explain");
  const [result, setResult] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const subscription = useSubscription();
  const { limitModalProps, upgradeModalProps, handleApiLimitError } = useLimitModal(subscription.currentPlan);

  const { usage, limits, loading: subLoading } = subscription;
  const aiUsed = usage.ai_requests ?? 0;
  const aiLimit = limits.ai_requests ?? 10;
  const aiExhausted = !subLoading && aiUsed >= aiLimit;

  const selectedType = REQUEST_TYPES.find((t) => t.id === requestType) || REQUEST_TYPES[0];

  const handleSend = async () => {
    if (aiExhausted) {
      handleApiLimitError({
        code: "AI_LIMIT_REACHED",
        current: aiUsed,
        limit: aiLimit,
        recommended_plan: "repetitor",
      });
      return;
    }
    if (!prompt.trim()) return;
    setSending(true);
    setError("");
    setResult("");
    try {
      const data = await sendAIRequest(prompt, requestType);
      setResult(data.result || "");
      subscription.refreshUsage();
    } catch (err) {
      const handled = handleApiLimitError(err);
      if (!handled) setError(err.message || "Ошибка запроса");
    } finally {
      setSending(false);
    }
  };

  return (
    <CabinetPageShell className="cb-section--ai">
      {limitModalProps && <UpgradeLimitModal {...limitModalProps} />}
      {upgradeModalProps && <CompactUpgradeModal {...upgradeModalProps} />}

      <CabinetPageHeader
        title="ИИ-помощник"
        subtitle="Генерация заданий, объяснений и комментариев."
      />

      <div className="ai-usage-row">
        <LimitBadge label="ИИ" used={aiUsed} limit={aiLimit} loading={subLoading} />
        {aiExhausted && (
          <Link to="/cabinet/upgrade" className="ai-upgrade-link">Увеличить лимит</Link>
        )}
      </div>

      <div className="ai-type-pills">
        {REQUEST_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ai-type-pill${requestType === t.id ? " ai-type-pill--active" : ""}`}
            onClick={() => setRequestType(t.id)}
          >
            {t.label}
            <span className="ai-type-pill__cost">{t.cost}кр</span>
          </button>
        ))}
      </div>

      <div className="ai-chat">
        <div className="ai-chat__input-row">
          <textarea
            className="ai-chat__input"
            placeholder={aiExhausted ? "Лимит запросов исчерпан" : "Введите запрос…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={aiExhausted || sending}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
            }}
          />
          <button
            type="button"
            className={`ai-chat__send${aiExhausted ? " ai-chat__send--blocked" : ""}`}
            onClick={handleSend}
            disabled={sending}
          >
            {aiExhausted ? (
              <>
                <CabinetIcon name="spark" />
                Увеличить лимит
              </>
            ) : sending ? (
              "Отправка…"
            ) : (
              <>
                <CabinetIcon name="spark" />
                Отправить
                <span className="ai-chat__cost">−{selectedType.cost}кр</span>
              </>
            )}
          </button>
        </div>

        {error && <p className="ai-chat__error" role="alert">{error}</p>}

        {result && (
          <div className="ai-chat__result">
            <p>{result}</p>
          </div>
        )}
      </div>
    </CabinetPageShell>
  );
}
*/
