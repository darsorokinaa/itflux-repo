import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { acceptCommunityInvite, previewCommunityInvite } from "../messages/api";
import { fetchCabinetSession } from "../../utils/cabinetAuth";
import "../styles/messages.css";

export default function CommunityInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const session = await fetchCabinetSession().catch(() => ({ authenticated: false }));
      if (!session?.authenticated) {
        navigate(`/cabinet/login?next=${encodeURIComponent(`/community/invite/${token}`)}`, { replace: true });
        return;
      }
      try {
        const data = await previewCommunityInvite(token);
        if (!cancel) setPreview(data);
      } catch {
        if (!cancel) setError("Приглашение недоступно");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, navigate]);

  const openChat = (conversationId) => {
    navigate(`/cabinet/messages?conversation=${conversationId}`);
  };

  const join = async () => {
    setJoining(true);
    setError("");
    try {
      const data = await acceptCommunityInvite({ token });
      openChat(data.conversation_id);
    } catch {
      setError("Приглашение недоступно");
      setJoining(false);
    }
  };

  return (
    <main className="cb-invite">
      {loading ? <p>Загрузка приглашения…</p> : null}
      {!loading && error ? (
        <section>
          <h1>Приглашение недоступно</h1>
          <p>Ссылка недействительна или у вас нет доступа к этому сообществу.</p>
        </section>
      ) : null}
      {!loading && preview ? (
        <section>
          <span className="cb-invite__icon" aria-hidden="true">{preview.icon || "#"}</span>
          <p className="cb-invite__kicker">Вас приглашают в сообщество</p>
          <h1>{preview.name}</h1>
          {preview.subject ? <span className="cb-invite__badge">{preview.subject}</span> : null}
          {preview.description ? <p>{preview.description}</p> : null}
          <p className="cb-invite__meta">{preview.member_count} участников</p>
          {preview.already_member ? (
            <button type="button" className="cb-msg__new" onClick={() => openChat(preview.conversation_id)}>Открыть сообщество</button>
          ) : (
            <button type="button" className="cb-msg__new" disabled={joining} onClick={join}>
              {joining ? "Вступаем…" : "Вступить в сообщество"}
            </button>
          )}
        </section>
      ) : null}
    </main>
  );
}
