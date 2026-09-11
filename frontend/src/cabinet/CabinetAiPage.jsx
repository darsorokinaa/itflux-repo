import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "./CabinetIcons";
import { CabinetPageShell, CabinetPageHeader } from "./CabinetSectionUi";
import UpgradeLimitModal from "./components/UpgradeLimitModal";
import CompactUpgradeModal from "./components/CompactUpgradeModal";
import { useLimitModal } from "./hooks/useLimitModal";
import {
  fetchAIConversation,
  fetchAIUsage,
  openAIAssistant,
  sendAIRequest,
} from "../utils/cabinetAuth";

function remainingLabel(kind, remaining, limit) {
  if (kind === "text") return `AI: ${remaining} из ${limit} запросов осталось`;
  return `Изображения: ${remaining} из ${limit}`;
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function CabinetAiPage() {
  const [usage, setUsage] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);
  const inflightKey = useRef("");

  const { limitModalProps, upgradeModalProps, handleApiLimitError } = useLimitModal(
    usage?.plan || null,
  );

  const loadUsage = useCallback(async () => {
    const data = await fetchAIUsage();
    setUsage(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opened = await openAIAssistant();
        if (cancelled) return;
        setConversationId(opened.conversation_id);
        setUsage(opened.usage);
        const detail = await fetchAIConversation(opened.conversation_id);
        if (cancelled) return;
        setMessages(detail.messages || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Не удалось открыть ИИ-помощник");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const textRemaining = usage?.text?.remaining ?? usage?.remaining ?? 0;
  const textLimit = usage?.text?.limit ?? usage?.limit ?? 0;
  const imageRemaining = usage?.images?.remaining ?? 0;
  const imageLimit = usage?.images?.limit ?? 0;
  const textExhausted = !loading && textLimit > 0 && textRemaining <= 0;
  const imageExhausted = !loading && imageLimit > 0 && imageRemaining <= 0;
  const warning = usage?.warning_level || "none";
  const nextPlan = usage?.recommended_plan;

  const appendAssistant = (data) => {
    const images = data.images || [];
    setMessages((prev) => [
      ...prev,
      {
        id: `asst-${Date.now()}`,
        role: "assistant",
        content: data.result || "",
        images,
      },
    ]);
    if (data.usage) setUsage(data.usage);
    if (data.conversation_id) setConversationId(data.conversation_id);
    setConfirmation(data.confirmation || null);
  };

  const send = async ({ text, confirmImages } = {}) => {
    const value = (text ?? prompt).trim();
    if (!value || sending) return;
    if (textExhausted) {
      handleApiLimitError({
        code: "AI_LIMIT_REACHED",
        current: usage?.text?.used,
        limit: textLimit,
        recommended_plan: nextPlan?.slug || "teacher",
        message: usage?.text ? `Вы использовали ${usage.text.used} AI-запросов в этом месяце.` : "",
      });
      return;
    }
    setSending(true);
    setError("");
    setConfirmation(null);
    if (confirmImages == null) {
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content: value, images: [] },
      ]);
      setPrompt("");
      setPendingPrompt(value);
    }
    const key = inflightKey.current || newIdempotencyKey();
    inflightKey.current = key;
    try {
      const data = await sendAIRequest(value, {
        conversationId,
        confirmImages,
        idempotencyKey: key,
      });
      inflightKey.current = "";
      appendAssistant(data);
      await loadUsage();
    } catch (err) {
      const handled = handleApiLimitError(err);
      if (!handled) {
        if (err.status === 409 && err.data?.code === "AI_IMAGE_CONFIRMATION") {
          setConfirmation(err.data);
          await loadUsage();
        } else {
          setError(err.data?.message || err.message || "Ошибка запроса");
        }
      }
    } finally {
      setSending(false);
    }
  };

  const onConfirmImages = (count) => {
    const text = pendingPrompt || prompt;
    send({ text, confirmImages: count });
  };

  return (
    <CabinetPageShell className="cb-section--ai">
      {limitModalProps && <UpgradeLimitModal {...limitModalProps} />}
      {upgradeModalProps && <CompactUpgradeModal {...upgradeModalProps} />}

      <CabinetPageHeader
        title="ИИ-помощник"
        subtitle="Задания, объяснения, планы уроков и учебные иллюстрации — с учётом вашего тарифа."
      />

      <div className="ai-usage-row">
        <span className={`ai-quota${warning === "high" || textExhausted ? " ai-quota--warn" : ""}`}>
          {remainingLabel("text", textRemaining, textLimit)}
        </span>
        <span className={`ai-quota${imageExhausted ? " ai-quota--warn" : ""}`}>
          {remainingLabel("images", imageRemaining, imageLimit)}
        </span>
        {textExhausted && nextPlan?.slug ? (
          <Link to="/cabinet/upgrade" className="ai-upgrade-link">
            Перейти на {nextPlan.name || "следующий тариф"}
          </Link>
        ) : null}
      </div>

      {warning === "mid" && !textExhausted ? (
        <p className="ai-hint">Осталось меньше 20% текстовых запросов в этом периоде.</p>
      ) : null}
      {warning === "high" && !textExhausted ? (
        <p className="ai-hint ai-hint--strong">Лимит почти исчерпан. После него текстовый ИИ приостановится до нового периода.</p>
      ) : null}
      {imageExhausted && !textExhausted ? (
        <p className="ai-hint">Лимит изображений на этот месяц закончился. Текстовый AI продолжает работать.</p>
      ) : null}
      {textExhausted && nextPlan ? (
        <div className="ai-upsell">
          <p>
            Вы использовали {usage?.text?.used || textLimit} AI-запросов в этом месяце.
            {nextPlan.name ? ` На тарифе «${nextPlan.name}» доступно ${nextPlan.text} AI-запросов и ${nextPlan.images} генераций изображений в месяц.` : ""}
          </p>
          <Link to="/cabinet/upgrade" className="ai-upgrade-link">Перейти на {nextPlan.name || "тариф"}</Link>
        </div>
      ) : null}

      <div className="ai-suggest">
        {[
          "Объясни тему простыми словами",
          "Придумай 5 задач на проценты в тематике Гарри Поттера",
          "Составь план урока и разминку",
          "Сделай тест из 8 вопросов",
        ].map((item) => (
          <button
            key={item}
            type="button"
            className="ai-type-pill"
            disabled={sending || textExhausted}
            onClick={() => setPrompt(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="ai-chat ai-chat--thread">
        <div className="ai-chat__thread" ref={listRef}>
          {loading ? <p className="ai-chat__muted">Загрузка…</p> : null}
          {!loading && messages.length === 0 ? (
            <p className="ai-chat__muted">
              Напишите, что нужно: объяснить тему, придумать задания, адаптировать задачу под интерес ученика или нарисовать иллюстрацию.
            </p>
          ) : null}
          {messages.map((msg) => (
            <div key={msg.id} className={`ai-bubble ai-bubble--${msg.role}`}>
              <div className="ai-bubble__text">{msg.content}</div>
              {Array.isArray(msg.images) && msg.images.length > 0 ? (
                <div className="ai-bubble__images">
                  {msg.images.map((img) => (
                    <img key={img.url} src={img.url} alt={img.alt || "Иллюстрация"} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {sending ? <p className="ai-chat__muted">Готовлю ответ…</p> : null}
        </div>

        {confirmation ? (
          <div className="ai-confirm">
            <p>{confirmation.message}</p>
            <div className="ai-confirm__actions">
              {(confirmation.options || []).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="cb-btn cb-btn--outline"
                  onClick={() => onConfirmImages(opt.confirm_images)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="ai-chat__error" role="alert">{error}</p> : null}

        <div className="ai-chat__input-row">
          <textarea
            className="ai-chat__input"
            placeholder={textExhausted ? "Лимит запросов исчерпан" : "Например: сделай 5 задач на дроби в тематике космоса и нарисуй иллюстрацию к каждой"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={textExhausted || sending}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
            }}
          />
          <button
            type="button"
            className={`ai-chat__send${textExhausted ? " ai-chat__send--blocked" : ""}`}
            onClick={() => send()}
            disabled={sending || (!prompt.trim() && !textExhausted)}
          >
            {textExhausted ? (
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
              </>
            )}
          </button>
        </div>
      </div>
    </CabinetPageShell>
  );
}
