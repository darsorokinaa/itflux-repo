import { useEffect, useMemo, useState } from "react";
import {
  communityMemberAction,
  createCommunity,
  fetchCommunities,
  inviteToCommunity,
  leaveCommunity,
  setCommunityNotifications,
  updateCommunity,
} from "./api";

const SUBJECTS = [
  "Информатика",
  "Математика",
  "Русский язык",
  "Физика",
  "Химия",
  "Биология",
  "Английский язык",
  "Обществознание",
  "История",
  "Литература",
];

const ROLE_GROUPS = [
  { id: "admin", title: "Администраторы" },
  { id: "moderator", title: "Модераторы" },
  { id: "member", title: "Участники" },
];

export function CommunityInfo({ info, onClose, onChanged, onLeft }) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [inviteUserId, setInviteUserId] = useState("");
  const [link, setLink] = useState("");
  const canModerate = info.my_role === "admin" || info.my_role === "moderator";
  const isAdmin = info.my_role === "admin";
  const members = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (info.members || []).filter((item) => !needle || item.name.toLowerCase().includes(needle));
  }, [info.members, query]);

  const act = async (fn) => {
    setError("");
    try {
      const next = await fn();
      if (next) onChanged(next);
    } catch (err) {
      setError(err.message || "Не удалось выполнить действие");
    }
  };

  return (
    <aside className="cb-msg__drawer" aria-label="О сообществе">
      <header>
        <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        <span className="cb-msg__avatar is-community">{info.icon || "#"}</span>
        <div>
          <strong>{info.name}</strong>
          <p>{info.subject || "Сообщество преподавателей"} · {info.member_count} участников</p>
        </div>
      </header>
      {info.description ? <p className="cb-msg__drawer-text">{info.description}</p> : null}
      <label className="cb-msg__search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск участников" />
      </label>
      <div className="cb-msg__drawer-list">
        {ROLE_GROUPS.map((group) => {
          const rows = members.filter((item) => item.role === group.id);
          if (!rows.length) return null;
          return (
            <div key={group.id}>
              <p className="cb-msg__group-title">{group.title}</p>
              {rows.map((item) => (
                <div key={item.user_id} className="cb-msg__member">
                  <span className="cb-msg__avatar is-teacher">
                    {item.initials}
                    {item.presence === "online" ? <span className="cb-msg__online" /> : null}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    {item.role_label ? <em>{item.role_label}</em> : null}
                    <small>{item.subtitle}</small>
                  </span>
                  {canModerate && !item.is_platform_admin && (isAdmin || item.role === "member") ? (
                    <span className="cb-msg__member-actions">
                      {isAdmin && item.role !== "admin" ? (
                        <button type="button" onClick={() => act(() => communityMemberAction(info.conversation_id, item.user_id, { action: "role", role: item.role === "moderator" ? "member" : "moderator" }))}>
                          {item.role === "moderator" ? "Снять модератора" : "Модератор"}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => act(() => communityMemberAction(info.conversation_id, item.user_id, { action: "mute", minutes: 60 }))}>Молчание 1 ч</button>
                      <button type="button" onClick={() => act(() => communityMemberAction(info.conversation_id, item.user_id, { action: "remove" }))}>Исключить</button>
                      {isAdmin ? (
                        <button type="button" onClick={() => act(() => communityMemberAction(info.conversation_id, item.user_id, { action: "ban" }))}>Заблокировать</button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <label>Уведомления
        <select
          value={info.notifications_mode || "all"}
          onChange={(event) => act(async () => {
            await setCommunityNotifications(info.conversation_id, { mode: event.target.value });
            return { ...info, notifications_mode: event.target.value };
          })}
        >
          <option value="all">Все сообщения</option>
          <option value="mentions">Только упоминания</option>
          <option value="off">Выключить</option>
        </select>
      </label>
      <div className="cb-msg__mute-row">
        {[{ label: "На 1 час", minutes: 60 }, { label: "На 8 часов", minutes: 480 }, { label: "На неделю", minutes: 10080 }].map((item) => (
          <button key={item.minutes} type="button" onClick={() => act(async () => {
            await setCommunityNotifications(info.conversation_id, { mode: info.notifications_mode || "all", muted_minutes: item.minutes });
            return info;
          })}>{item.label}</button>
        ))}
      </div>
      {canModerate ? (
        <form className="cb-msg__drawer-form" onSubmit={(event) => {
          event.preventDefault();
          act(async () => {
            const data = await inviteToCommunity(info.conversation_id, { user_id: Number(inviteUserId) });
            setInviteUserId("");
            if (!data.invited_user_id) setLink(data.path);
            return info;
          });
        }}>
          <input value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)} placeholder="ID преподавателя" inputMode="numeric" />
          <button type="submit">Пригласить</button>
          <button type="button" onClick={() => act(async () => {
            const data = await inviteToCommunity(info.conversation_id, {});
            setLink(data.path);
            return info;
          })}>Ссылка</button>
        </form>
      ) : null}
      {link ? <p className="cb-msg__drawer-text">{link}</p> : null}
      {isAdmin ? (
        <form className="cb-msg__drawer-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          act(() => updateCommunity(info.conversation_id, {
            name: form.get("name"),
            description: form.get("description"),
            subject: form.get("subject"),
            messages_enabled: form.get("messages_enabled") === "on",
            is_archived: form.get("is_archived") === "on",
            is_active: form.get("is_active") === "on",
          }));
        }}>
          <input name="name" defaultValue={info.name} placeholder="Название" />
          <input name="subject" defaultValue={info.subject} placeholder="Предмет" list="community-subjects" />
          <textarea name="description" defaultValue={info.description} placeholder="Описание" rows={3} />
          <label><input name="messages_enabled" type="checkbox" defaultChecked={info.messages_enabled} /> Разрешить сообщения</label>
          <label><input name="is_active" type="checkbox" defaultChecked={info.is_active} /> Сообщество открыто</label>
          <label><input name="is_archived" type="checkbox" defaultChecked={info.is_archived} /> В архиве</label>
          <button type="submit">Сохранить</button>
        </form>
      ) : null}
      {info.can_leave ? (
        <button type="button" className="cb-msg__danger" onClick={() => act(async () => {
          await leaveCommunity(info.conversation_id);
          onLeft();
          return null;
        })}>Покинуть сообщество</button>
      ) : null}
      {error ? <p className="cb-msg__error">{error}</p> : null}
    </aside>
  );
}

export function CommunityAdmin({ onClose, onOpen }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => fetchCommunities().then((data) => setRows(data.communities || [])).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  return (
    <aside className="cb-msg__drawer cb-msg__drawer--wide" aria-label="Сообщества">
      <header>
        <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        <div><strong>Сообщества</strong><p>Закрытые чаты преподавателей</p></div>
      </header>
      <form className="cb-msg__drawer-form" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setCreating(true);
        setError("");
        try {
          const created = await createCommunity({
            name: form.get("name"),
            subject: form.get("subject"),
            description: form.get("description"),
            icon: form.get("icon"),
            image: form.get("image")?.size ? form.get("image") : "",
            messages_enabled: form.get("messages_enabled") === "on" ? "true" : "false",
            is_active: form.get("status") !== "closed" ? "true" : "false",
          });
          event.currentTarget.reset();
          await load();
          if (created.conversation_id) onOpen(created.conversation_id);
        } catch (err) {
          setError(err.message || "Не создано");
        } finally {
          setCreating(false);
        }
      }}>
        <input name="name" required placeholder="Название" />
        <input name="subject" placeholder="Предмет" list="community-subjects" />
        <datalist id="community-subjects">
          {SUBJECTS.map((item) => <option key={item} value={item} />)}
        </datalist>
        <textarea name="description" rows={3} placeholder="Описание" />
        <input name="icon" maxLength={8} placeholder="Значок, например #" />
        <input name="image" type="file" accept="image/png,image/jpeg,image/webp" />
        <label><input name="messages_enabled" type="checkbox" defaultChecked /> Разрешить сообщения</label>
        <select name="status" defaultValue="open">
          <option value="open">Активно</option>
          <option value="closed">Закрыто</option>
        </select>
        <button type="submit" disabled={creating}>Создать сообщество</button>
      </form>
      <div className="cb-msg__admin-table">
        {rows.map((row) => (
          <button key={row.id} type="button" onClick={() => onOpen(row.conversation_id)}>
            <strong>{row.name}</strong>
            <span>{row.subject || "Без предмета"} · {row.member_count} · приглашений {row.invite_count}</span>
            <small>{row.is_archived ? "Архив" : row.is_active ? "Активно" : "Закрыто"}</small>
          </button>
        ))}
      </div>
      {error ? <p className="cb-msg__error">{error}</p> : null}
    </aside>
  );
}
