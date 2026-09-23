import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { sendMessagingFrame } from "../messages/live";
import "../styles/messages.css";
import { CommunityAdmin, CommunityInfo } from "../messages/CommunityPanels";
import {
  SUPPORT_CATEGORIES,
  acceptCommunityInvite,
  attachmentUrl,
  createSupportTicket,
  declineCommunityInvite,
  deleteMessage,
  editMessage,
  fetchCommunity,
  fetchContacts,
  fetchConversationFiles,
  fetchMessageConversations,
  fetchMessages,
  markMessagesDelivered,
  markMessagesRead,
  openDirectConversation,
  pinCommunityMessage,
  reactToMessage,
  reportCommunityMessage,
  searchMessages,
  sendMessage,
} from "../messages/api";

const REACTIONS = ["👍", "❤️", "🔥", "👏", "💡", "🤔"];

const FILE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf,.doc,.docx,.txt";

function contactLines(item) {
  if (item.role !== "teacher") return { title: item.name, detail: item.subtitle || "" };
  const login = (item.login || "").trim();
  const email = (item.email || "").trim();
  const name = (item.name || "").trim();
  const nameIsLogin = name && login && name.toLowerCase() === login.toLowerCase();
  return {
    title: nameIsLogin ? login : (name || login),
    detail: email || (nameIsLogin ? "" : login),
  };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayDiff(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
}

function formatListTime(iso) {
  const diff = dayDiff(iso);
  if (diff == null) return "";
  const date = new Date(iso);
  if (diff === 0) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function formatClock(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dayLabel(iso) {
  const diff = dayDiff(iso);
  if (diff == null) return "";
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

function fileKind(file) {
  const type = file.type || "";
  const name = (file.name || "").toLowerCase();
  if (type.startsWith("image/")) return "Изображение";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  return "Документ";
}

function presenceLabel(value) {
  if (value === "online") return "онлайн";
  if (value === "recent") return "был недавно";
  return "";
}

function publishUnread(count) {
  window.dispatchEvent(new CustomEvent("cabinet:messages-unread", { detail: { unread_count: count } }));
}

function Checks({ status }) {
  if (!status) return null;
  const title = status === "read" ? "Прочитано" : status === "delivered" ? "Доставлено" : "Отправлено";
  const double = status === "read" || status === "delivered";
  return (
    <span className={`cb-msg__checks${status === "read" ? " is-read" : ""}`} title={title}>
      <svg width="15" height="11" viewBox="0 0 18 12" fill="none" aria-hidden="true">
        {double ? (
          <path d="m1 6 3 3 5-6M7 8l1.5 1.5L17 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="m2 6 4 4L15 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
    </svg>
  );
}

function IconAttach() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m20.5 11.5-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 1 1 5 5L9.6 18.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m4 4 16 8-16 8 3-8-3-8Z" strokeLinejoin="round" /><path d="M7 12h13" />
    </svg>
  );
}

export default function CabinetMessagesPage() {
  const [viewerRole, setViewerRole] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [communityInfo, setCommunityInfo] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [showAllCommunities, setShowAllCommunities] = useState(false);
  const [messageHits, setMessageHits] = useState([]);
  const [mentions, setMentions] = useState([]);
  const [unreadAnchor, setUnreadAnchor] = useState(null);
  const [communityFiles, setCommunityFiles] = useState(null);
  const [reportFor, setReportFor] = useState(null);
  const [authorFilter, setAuthorFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [filesOnly, setFilesOnly] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerContacts, setPickerContacts] = useState([]);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [blockedSend, setBlockedSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(!window.navigator.onLine);
  const [menuId, setMenuId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [chatSearch, setChatSearch] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [headerMenu, setHeaderMenu] = useState(false);
  const [ticketForm, setTicketForm] = useState({ category: "technical", subject: "", text: "", files: [] });
  const logRef = useRef(null);
  const composerRef = useRef(null);
  const typingSentRef = useRef(false);
  const typingStopRef = useRef(null);
  const lastTypingAtRef = useRef(0);
  const [typingUntil, setTypingUntil] = useState({});
  const [typingNow, setTypingNow] = useState(() => Date.now());

  const active = useMemo(
    () => conversations.find((item) => item.id === activeId) || null,
    [conversations, activeId],
  );

  const tabs = viewerRole === "student"
    ? [
      { id: "all", label: "Все" },
      { id: "unread", label: "Непрочитанные" },
      { id: "teachers", label: "Мои учителя" },
      { id: "service", label: "Сервис" },
    ]
    : [
      { id: "all", label: "Все" },
      { id: "unread", label: "Непрочитанные" },
      { id: "direct", label: "Личные" },
      { id: "communities", label: "Сообщества" },
    ];

  const sectionTitle = {
    service: "Сервис",
    communities: "Сообщества",
    teachers: viewerRole === "student" ? "Мои учителя" : "Личные",
    students: "Ученики",
  };

  const visibleDialogs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations.filter((item) => {
      if (tab === "unread" && !item.unread_count && !item.mention_count) return false;
      if (tab === "direct" && item.section !== "teachers") return false;
      if (tab === "communities" && item.section !== "communities") return false;
      if (tab !== "all" && tab !== "unread" && tab !== "direct" && tab !== "communities" && item.section !== tab) return false;
      if (!needle) return true;
      return [item.title, item.subtitle, item.last_message_excerpt].join(" ").toLowerCase().includes(needle);
    });
  }, [conversations, query, tab]);

  const groupedDialogs = useMemo(() => {
    const order = ["service", "communities", "teachers", "students"];
    return order
      .map((section) => {
        const items = visibleDialogs.filter((item) => item.section === section);
        const limited = section === "communities" && tab !== "communities" && !showAllCommunities;
        return {
          section,
          title: sectionTitle[section],
          items: limited ? items.slice(0, 5) : items,
          hiddenCount: limited ? Math.max(0, items.length - 5) : 0,
        };
      })
      .filter((group) => group.items.length);
  }, [visibleDialogs, sectionTitle, tab, showAllCommunities]);

  const startable = useMemo(() => {
    const known = new Set(conversations.map((item) => item.id));
    return contacts.filter((item) => !item.conversation_id || !known.has(item.conversation_id));
  }, [contacts, conversations]);

  const loadList = useCallback(async () => {
    const data = await fetchMessageConversations();
    setViewerRole(data.viewer_role || "");
    setCanManage(Boolean(data.can_manage_communities));
    setInvitations(data.invitations || []);
    setConversations(data.conversations || []);
    return data.conversations || [];
  }, []);

  const loadThread = useCallback(async (conversationId, { after } = {}) => {
    const data = await fetchMessages(conversationId, after ? { after } : {});
    setMessages((current) => {
      if (!after) return data.messages || [];
      const known = new Set(current.map((item) => item.id));
      const extra = (data.messages || []).filter((item) => !known.has(item.id));
      return extra.length ? [...current, ...extra] : current;
    });
    const rows = data.messages || [];
    const last = rows[rows.length - 1];
    if (last) {
      markMessagesDelivered(conversationId, last.id).catch(() => null);
      const read = await markMessagesRead(conversationId, last.id);
      publishUnread(read.unread_count);
      setConversations((current) => current.map((item) => (
        item.id === conversationId ? { ...item, unread_count: 0 } : item
      )));
    }
    return data;
  }, []);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (activeId || composing || conversations.length === 0) return;
    const wanted = searchParams.get("conversation");
    if (wanted && conversations.some((item) => item.id === wanted)) {
      setActiveId(wanted);
      return;
    }
    if (window.matchMedia("(max-width: 760px)").matches) return;
    setActiveId(conversations[0].id);
  }, [conversations, activeId, composing, searchParams]);

  useEffect(() => {
    const current = conversations.find((item) => item.id === activeId);
    if (!current || current.type !== "community") {
      setCommunityInfo(null);
      setInfoOpen(false);
      setCommunityFiles(null);
      setUnreadAnchor(null);
      return;
    }
    setUnreadAnchor(current.unread_count ? (current.last_read_message_id || 0) : null);
    fetchCommunity(current.id).then(setCommunityInfo).catch(() => setCommunityInfo(null));
  }, [activeId]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setMessageHits([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      searchMessages(needle).then((data) => setMessageHits(data.results || [])).catch(() => setMessageHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    loadList()
      .catch(() => { if (!cancelled) setError("Не удалось загрузить диалоги"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadList]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 1) {
      setContacts([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      fetchContacts(needle).then((data) => setContacts(data.contacts || [])).catch(() => setContacts([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const timer = window.setTimeout(() => {
      fetchContacts(pickerQuery.trim()).then((data) => setPickerContacts(data.contacts || [])).catch(() => setPickerContacts([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [pickerOpen, pickerQuery]);

  useEffect(() => {
    if (!activeId) return undefined;
    setText(window.localStorage.getItem(`msg-draft:${activeId}`) || "");
    setReplyTo(null);
    setEditing(null);
    setError("");
    setChatQuery("");
    setThreadLoading(true);
    loadThread(activeId)
      .catch(() => setError("Не удалось открыть диалог"))
      .finally(() => setThreadLoading(false));
    return undefined;
  }, [activeId, loadThread]);

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
  }, [text, activeId, composing]);

  useEffect(() => {
    const node = logRef.current;
    if (node && !chatQuery) node.scrollTop = node.scrollHeight;
  }, [messages, activeId, composing, chatQuery, typingUntil]);

  useEffect(() => {
    const onLive = (event) => {
      const frame = event.detail;
      if (!frame) return;
      const payload = frame.payload || {};
      if (frame.type === "typing" && payload.conversation_id) {
        const conversationId = payload.conversation_id;
        setTypingUntil((current) => {
          const next = { ...current };
          if (payload.active) next[conversationId] = Date.now() + 4000;
          else delete next[conversationId];
          return next;
        });
        return;
      }
      if (frame.type === "message.read" && payload.conversation_id === activeId) {
        const cursor = Number(payload.message_id);
        setMessages((current) => current.map((item) => (
          item.is_own && item.id <= cursor ? { ...item, delivery_status: "read" } : item
        )));
        return;
      }
      if ((frame.type === "message.updated" || frame.type === "message.deleted") && payload.message) {
        setMessages((current) => current.map((item) => (
          item.id === payload.message.id ? payload.message : item
        )));
        loadList().catch(() => null);
        return;
      }
      if (frame.type !== "message.new") return;
      if (payload.conversation_id) {
        setTypingUntil((current) => {
          if (!current[payload.conversation_id]) return current;
          const next = { ...current };
          delete next[payload.conversation_id];
          return next;
        });
      }
      if (payload.conversation_id !== activeId || !payload.message) {
        loadList().catch(() => null);
        return;
      }
      setMessages((current) => (
        current.some((item) => item.id === payload.message.id) ? current : [...current, payload.message]
      ));
      markMessagesRead(activeId, payload.message.id)
        .then((data) => publishUnread(data.unread_count))
        .catch(() => null);
      loadList().catch(() => null);
    };
    window.addEventListener("cabinet:messaging", onLive);
    return () => window.removeEventListener("cabinet:messaging", onLive);
  }, [activeId, loadList]);

  useEffect(() => {
    if (!activeId) return undefined;
    const id = window.setInterval(() => {
      const last = messages[messages.length - 1];
      loadThread(activeId, { after: last?.id }).catch(() => null);
    }, 15000);
    return () => window.clearInterval(id);
  }, [activeId, messages, loadThread]);

  useEffect(() => {
    if (!Object.keys(typingUntil).length) return undefined;
    const id = window.setInterval(() => setTypingNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [typingUntil]);

  const stopOwnTyping = useCallback((conversationId) => {
    window.clearTimeout(typingStopRef.current);
    if (!typingSentRef.current) return;
    typingSentRef.current = false;
    if (conversationId) {
      sendMessagingFrame({ type: "typing", conversation_id: conversationId, active: false });
    }
  }, []);

  useEffect(() => () => stopOwnTyping(activeId), [activeId, stopOwnTyping]);

  const clearFiles = () => {
    files.forEach((item) => { if (item.url) URL.revokeObjectURL(item.url); });
    setFiles([]);
  };

  const submitMessage = async () => {
    if (!activeId || sending) return;
    stopOwnTyping(activeId);
    const snapshot = text;
    setSending(true);
    setError("");
    setBlockedSend(false);
    try {
      if (editing) {
        const data = await editMessage(activeId, editing.id, snapshot);
        setMessages((current) => current.map((item) => (item.id === data.message.id ? data.message : item)));
        setEditing(null);
        setText("");
      } else {
        const data = await sendMessage(activeId, {
          text: snapshot,
          replyTo: replyTo?.id,
          clientMessageId: crypto.randomUUID(),
          files: files.map((item) => item.file),
          mentionUserIds: mentions.filter((item) => snapshot.includes(`@${item.name}`)).map((item) => item.user_id),
        });
        setMessages((current) => (
          current.some((item) => item.id === data.message.id) ? current : [...current, data.message]
        ));
        setText("");
        clearFiles();
        setReplyTo(null);
        setMentions([]);
        window.localStorage.removeItem(`msg-draft:${activeId}`);
      }
      await loadList();
    } catch (err) {
      setText(snapshot);
      setBlockedSend(err.code === "MESSAGE_BLOCKED");
      setError(err.message || "Не отправлено");
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (messageId) => {
    if (!activeId) return;
    try {
      const data = await deleteMessage(activeId, messageId);
      setMessages((current) => current.map((item) => (item.id === data.message.id ? data.message : item)));
      setMenuId(null);
      setConfirmDeleteId(null);
      await loadList();
    } catch (err) {
      setError(err.message || "Не удалось удалить");
    }
  };

  const chooseContact = async (contact) => {
    setError("");
    try {
      if (contact.conversation_id) {
        setActiveId(contact.conversation_id);
      } else {
        const data = await openDirectConversation(contact.user_id);
        const rows = await loadList();
        setActiveId(data.conversation?.id || rows.find((item) => item.id === data.conversation?.id)?.id || null);
      }
      setPickerOpen(false);
      setComposing(false);
      setQuery("");
    } catch (err) {
      setError(err.message || "Диалог недоступен");
    }
  };

  const submitTicket = async (event) => {
    event.preventDefault();
    setSending(true);
    setError("");
    setBlockedSend(false);
    try {
      const data = await createSupportTicket(ticketForm);
      setComposing(false);
      setTicketForm({ category: "technical", subject: "", text: "", files: [] });
      const rows = await loadList();
      setActiveId(data.conversation?.id || rows[0]?.id || null);
    } catch (err) {
      setBlockedSend(err.code === "MESSAGE_BLOCKED");
      setError(err.message || "Не отправлено");
    } finally {
      setSending(false);
    }
  };

  const onComposerKey = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  };

  const shownMessages = messages.filter((item) => {
    if (chatQuery.trim() && !(item.text || "").toLowerCase().includes(chatQuery.trim().toLowerCase())) return false;
    if (authorFilter && String(item.author_user_id) !== String(authorFilter)) return false;
    if (filesOnly && !(item.attachments || []).length) return false;
    if (dateFilter && !(item.created_at || "").startsWith(dateFilter)) return false;
    return true;
  });

  useEffect(() => {
    if (!activeId || active?.type !== "community") return undefined;
    if (!chatQuery && !authorFilter && !dateFilter && !filesOnly) return undefined;
    const timer = window.setTimeout(() => {
      fetchMessages(activeId, {
        q: chatQuery,
        author: authorFilter,
        date: dateFilter,
        hasFiles: filesOnly,
      }).then((data) => setMessages(data.messages || [])).catch(() => null);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeId, active?.type, chatQuery, authorFilter, dateFilter, filesOnly]);
  const historyOnly = active?.type === "direct" && active?.can_compose === false;
  const composerLocked = historyOnly || (active?.type === "developer" && !(replyTo && !replyTo.reply_disabled));
  const peerTyping = Boolean(activeId && (typingUntil[activeId] || 0) > typingNow);

  const noteTyping = (hasText) => {
    if (!activeId || composerLocked) {
      stopOwnTyping(activeId);
      return;
    }
    if (!hasText) {
      stopOwnTyping(activeId);
      return;
    }
    const now = Date.now();
    if (!typingSentRef.current || now - lastTypingAtRef.current > 2000) {
      typingSentRef.current = true;
      lastTypingAtRef.current = now;
      sendMessagingFrame({ type: "typing", conversation_id: activeId, active: true });
    }
    window.clearTimeout(typingStopRef.current);
    typingStopRef.current = window.setTimeout(() => stopOwnTyping(activeId), 2500);
  };
  const threadOpen = Boolean(activeId || composing || pickerOpen);
  let lastDay = "";

  const pickerGroups = ["teachers", "students"]
    .map((section) => ({
      section,
      title: section === "students" ? "Мои ученики" : (viewerRole === "student" ? "Мои учителя" : "Преподаватели"),
      items: pickerContacts.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length);

  return (
    <div className={`cb-msg${threadOpen ? " is-thread" : ""}`}>
      <aside className="cb-msg__sidebar" aria-label="Список диалогов">
        <div className="cb-msg__head">
          <h1>Сообщения</h1>
          <p>Общение внутри платформы</p>
        </div>
        <label className="cb-msg__search">
          <IconSearch />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по сообщениям"
          />
        </label>
        <div className="cb-msg__tabs" role="tablist">
          {tabs.map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="cb-msg__dialogs">
          {loading ? <p className="cb-msg__hint">Загрузка…</p> : null}
          {invitations.map((invite) => (
            <article key={invite.id} className="cb-msg__invite">
              <span className="cb-msg__avatar is-community">{invite.icon || "#"}</span>
              <div>
                <p>Вас приглашают в сообщество</p>
                <strong>{invite.name}</strong>
                <span>{invite.description || "Закрытое сообщество преподавателей"}</span>
                <small>{invite.member_count} участников{invite.invited_by ? ` · ${invite.invited_by}` : ""}</small>
                <div>
                  <button type="button" onClick={async () => {
                    const data = await acceptCommunityInvite({ invite_id: invite.id });
                    const rows = await loadList();
                    setActiveId(data.conversation_id || rows.find((item) => item.community_id)?.id || null);
                  }}>Вступить</button>
                  <button type="button" onClick={async () => {
                    await declineCommunityInvite({ invite_id: invite.id });
                    setInvitations((current) => current.filter((item) => item.id !== invite.id));
                  }}>Отклонить</button>
                </div>
              </div>
            </article>
          ))}
          {!loading && groupedDialogs.length === 0 && startable.length === 0 ? (
            <div className="cb-msg__quiet">
              <p>{query ? "Ничего не найдено" : "Здесь появятся ваши сообщения"}</p>
              {!query ? <button type="button" onClick={() => setPickerOpen(true)}>Написать сообщение</button> : null}
            </div>
          ) : null}
          {groupedDialogs.map((group) => (
            <div key={group.section} className="cb-msg__group">
              <p className="cb-msg__group-title">{group.title}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`cb-msg__dialog${item.type === "community" ? " is-community" : ""}${item.id === activeId && !composing ? " is-active" : ""}`}
                  onClick={() => { setComposing(false); setPickerOpen(false); setActiveId(item.id); }}
                >
                  <span className={`cb-msg__avatar is-${item.type}`}>
                    {item.type === "community" ? "#" : item.initials}
                    {item.presence === "online" ? <span className="cb-msg__online" /> : null}
                  </span>
                  <span className="cb-msg__dialog-main">
                    <span className="cb-msg__name-row">
                      <span className="cb-msg__name">{item.type === "community" ? `# ${item.title}` : item.title}</span>
                      {item.type === "developer" ? <span className="cb-msg__verify" title="Официальный канал">✓</span> : null}
                    </span>
                    {item.subtitle && item.type === "direct" ? <span className="cb-msg__role">{item.subtitle}</span> : null}
                    {item.type === "community" ? <span className="cb-msg__role">{item.member_count} участников</span> : null}
                    <span className="cb-msg__preview">
                      {(typingUntil[item.id] || 0) > typingNow ? (
                        <span className="cb-msg__typing">печатает…</span>
                      ) : (
                        <>
                          {item.last_message_own && item.last_delivery_status ? <Checks status={item.last_delivery_status} /> : null}
                          {item.last_message_excerpt || "Нет сообщений"}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="cb-msg__meta">
                    <span>{formatListTime(item.last_message_at)}</span>
                    {item.mention_count > 0 ? <span className="cb-msg__badge is-mention">@ {item.mention_count}</span> : null}
                    {item.unread_count > 0 ? <span className="cb-msg__badge">{item.unread_count}</span> : null}
                  </span>
                </button>
              ))}
              {group.hiddenCount > 0 ? (
                <button type="button" className="cb-msg__more-link" onClick={() => setShowAllCommunities(true)}>Показать все</button>
              ) : null}
            </div>
          ))}
          {messageHits.length ? (
            <div className="cb-msg__group">
              <p className="cb-msg__group-title">В сообщениях</p>
              {messageHits.map((hit) => (
                <button key={hit.message_id} type="button" className="cb-msg__dialog" onClick={() => { setActiveId(hit.conversation_id); setChatQuery(query); setChatSearch(true); }}>
                  <span className="cb-msg__dialog-main"><span className="cb-msg__preview">{hit.excerpt}</span></span>
                </button>
              ))}
            </div>
          ) : null}
          {startable.length ? (
            <div className="cb-msg__group">
              <p className="cb-msg__group-title">Начать диалог</p>
              {startable.map((item) => (
                <button key={item.user_id} type="button" className="cb-msg__dialog" onClick={() => chooseContact(item)}>
                  <span className={`cb-msg__avatar is-${item.role}`}>{item.initials}</span>
                  <span className="cb-msg__dialog-main">
                    <span className="cb-msg__name">{contactLines(item).title}</span>
                    {contactLines(item).detail ? <span className="cb-msg__role">{contactLines(item).detail}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="cb-msg__foot">
          {canManage ? (
            <button type="button" className="cb-msg__quiet-btn" onClick={() => setManageOpen(true)}>Сообщества</button>
          ) : null}
          <button type="button" className="cb-msg__new" onClick={() => { setPickerOpen(true); setPickerQuery(""); }}>
            Новое сообщение
          </button>
        </div>
      </aside>

      <section className="cb-msg__chat" aria-label="Диалог">
        {offline ? <p className="cb-msg__banner">Нет сети. Сообщение отправится, когда связь появится.</p> : null}
        {pickerOpen ? (
          <div className="cb-msg__picker">
            <header className="cb-msg__chat-head">
              <button type="button" className="cb-msg__icon" onClick={() => setPickerOpen(false)} aria-label="Закрыть">×</button>
              <div>
                <h2>Новое сообщение</h2>
                <p>{viewerRole === "student" ? "Найдите преподавателя по почте или логину" : "Ученики в списке, преподавателя — по почте или логину"}</p>
              </div>
            </header>
            <label className="cb-msg__search">
              <IconSearch />
              <input
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder={viewerRole === "student" ? "Почта или логин" : "Почта или логин преподавателя"}
              />
            </label>
            <div className="cb-msg__picker-list">
              {pickerGroups.length === 0 ? (
                <p className="cb-msg__hint">
                  {pickerQuery.trim().length >= 3 ? "Никого не найдено" : "Введите почту или логин преподавателя"}
                </p>
              ) : null}
              {pickerGroups.map((group) => (
                <div key={group.section}>
                  <p className="cb-msg__group-title">{group.title}</p>
                  {group.items.map((item) => {
                    const lines = contactLines(item);
                    return (
                      <button key={item.user_id} type="button" className="cb-msg__dialog" onClick={() => chooseContact(item)}>
                        <span className={`cb-msg__avatar is-${item.role}`}>
                          {item.initials}
                          {item.presence === "online" ? <span className="cb-msg__online" /> : null}
                        </span>
                        <span className="cb-msg__dialog-main">
                          <span className="cb-msg__name">{lines.title}</span>
                          {lines.detail ? <span className="cb-msg__role">{lines.detail}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : composing ? (
          <form className="cb-msg__form" onSubmit={submitTicket}>
            <header className="cb-msg__chat-head">
              <button type="button" className="cb-msg__icon cb-msg__back" onClick={() => setComposing(false)} aria-label="Назад">←</button>
              <div>
                <h2>Новое обращение</h2>
                <p>Сообщение уйдёт в поддержку</p>
              </div>
            </header>
            <div className="cb-msg__form-body">
              <label>Категория
                <select value={ticketForm.category} onChange={(event) => setTicketForm((form) => ({ ...form, category: event.target.value }))}>
                  {SUPPORT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>Тема
                <input value={ticketForm.subject} required maxLength={200} onChange={(event) => setTicketForm((form) => ({ ...form, subject: event.target.value }))} />
              </label>
              <label>Сообщение
                <textarea required rows={5} value={ticketForm.text} onChange={(event) => setTicketForm((form) => ({ ...form, text: event.target.value }))} />
              </label>
              <label className="cb-msg__file-pick">Вложение
                <input type="file" accept={FILE_ACCEPT} onChange={(event) => setTicketForm((form) => ({ ...form, files: [...event.target.files] }))} />
              </label>
              {error ? (
                <p className="cb-msg__error">
                  {error}{" "}
                  {blockedSend ? (
                    <button type="button" onClick={() => setError("")}>Исправить сообщение</button>
                  ) : null}
                </p>
              ) : null}
              <button type="submit" className="cb-msg__new" disabled={sending}>Отправить</button>
            </div>
          </form>
        ) : active ? (
          <>
            <header className="cb-msg__chat-head">
              <button type="button" className="cb-msg__icon cb-msg__back" onClick={() => setActiveId(null)} aria-label="Назад">←</button>
              <button type="button" className={`cb-msg__avatar is-${active.type} cb-msg__avatar-btn`} onClick={() => active.type === "community" && setInfoOpen(true)}>
                {active.type === "community" ? "#" : active.initials}
              </button>
              <div className="cb-msg__who">
                <h2>
                  <button type="button" className="cb-msg__title-btn" onClick={() => active.type === "community" && setInfoOpen(true)}>
                    {active.type === "community" ? active.title : active.title}
                  </button>
                  {active.type === "developer" ? <span className="cb-msg__verify" title="Официальный канал">✓</span> : null}
                </h2>
                <p className={peerTyping ? "cb-msg__typing" : undefined} aria-live="polite">
                  {peerTyping ? "печатает…" : [active.subtitle, presenceLabel(active.presence)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button type="button" className="cb-msg__icon" aria-label="Поиск по чату" onClick={() => setChatSearch((value) => !value)}>
                <IconSearch />
              </button>
              {active.type === "community" ? (
                <button type="button" className="cb-msg__icon" aria-label="Участники" onClick={() => setInfoOpen(true)}>☺</button>
              ) : null}
              <div className="cb-msg__menu-wrap">
                <button type="button" className="cb-msg__icon" aria-label="Меню диалога" onClick={() => setHeaderMenu((value) => !value)}>•••</button>
                {headerMenu ? (
                  <div className="cb-msg__menu">
                    {active.type === "support" ? (
                      <button type="button" onClick={() => { setComposing(true); setHeaderMenu(false); }}>Новое обращение</button>
                    ) : (
                      <button type="button" onClick={() => { setChatSearch(true); setHeaderMenu(false); }}>Найти в этом чате</button>
                    )}
                    {active.type === "community" ? (
                      <button type="button" onClick={() => {
                        setHeaderMenu(false);
                        fetchConversationFiles(active.id).then((data) => setCommunityFiles(data.files || [])).catch(() => setCommunityFiles([]));
                      }}>Медиа и файлы</button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </header>
            {chatSearch ? (
              <div className="cb-msg__chat-filters">
                <label className="cb-msg__search cb-msg__search--chat">
                  <IconSearch />
                  <input value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} placeholder="Поиск в этом чате" />
                </label>
                {active.type === "community" ? (
                  <div className="cb-msg__filter-row">
                    <select value={authorFilter} onChange={(event) => setAuthorFilter(event.target.value)}>
                      <option value="">Автор</option>
                      {(communityInfo?.members || []).map((item) => <option key={item.user_id} value={item.user_id}>{item.name}</option>)}
                    </select>
                    <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
                    <label><input type="checkbox" checked={filesOnly} onChange={(event) => setFilesOnly(event.target.checked)} /> С файлами</label>
                  </div>
                ) : null}
              </div>
            ) : null}
            {active.type === "community" && communityInfo?.pinned?.length ? (
              <button type="button" className="cb-msg__pinbar" onClick={() => document.getElementById(`cb-msg-${communityInfo.pinned[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                <span>Закреплено</span>
                <strong>{communityInfo.pinned[0].text}</strong>
              </button>
            ) : null}
            {communityFiles ? (
              <div className="cb-msg__files">
                <button type="button" onClick={() => setCommunityFiles(null)}>Закрыть</button>
                {communityFiles.length === 0 ? <p>Файлов пока нет</p> : communityFiles.map((file) => (
                  <a key={file.id} href={attachmentUrl(file.id)}>{file.name}</a>
                ))}
              </div>
            ) : null}
            <div className="cb-msg__log" ref={logRef}>
              {threadLoading ? <p className="cb-msg__hint">Загрузка переписки…</p> : null}
              {!threadLoading && shownMessages.length === 0 ? (
                <div className="cb-msg__quiet">
                  <p>{chatQuery ? "Ничего не найдено" : "Здесь появятся ваши сообщения"}</p>
                  {!chatQuery && active.type !== "developer" ? <span>Напишите первое сообщение ниже.</span> : null}
                </div>
              ) : null}
              {shownMessages.map((message, index) => {
                const day = dayLabel(message.created_at);
                const showDay = day && day !== lastDay;
                if (showDay) lastDay = day;
                const previous = shownMessages[index - 1];
                const community = active.type === "community";
                const sameAuthor = previous && previous.author_user_id === message.author_user_id;
                const closeInTime = previous && Math.abs(new Date(message.created_at) - new Date(previous.created_at)) < 8 * 60 * 1000;
                const grouped = community
                  ? sameAuthor && closeInTime && !showDay && !message.deleted
                  : previous && previous.is_own === message.is_own && !showDay && !message.is_important;
                const official = active.type === "developer" && !message.is_own && !message.deleted;
                const showNew = unreadAnchor != null && message.id > unreadAnchor && (!previous || previous.id <= unreadAnchor);
                return (
                  <div key={message.id}>
                    {showDay ? <div className="cb-msg__day">{day}</div> : null}
                    {showNew ? <div className="cb-msg__day">Новые сообщения</div> : null}
                    {message.ticket && !grouped ? (
                      <div className="cb-msg__day">{message.ticket.category_label}: {message.ticket.subject}</div>
                    ) : null}
                    {message.is_important && !message.deleted ? (
                      <article className="cb-msg__important" id={`cb-msg-${message.id}`}>
                        <span aria-hidden="true">!</span>
                        <div>
                          <strong>Важное</strong>
                          <p>{message.text}</p>
                        </div>
                      </article>
                    ) : (
                      <div className={`cb-msg__row${message.is_own ? " is-own" : ""}${grouped ? " is-grouped" : ""}${official ? " is-official" : ""}${community ? " is-community" : ""}`}>
                        <article id={`cb-msg-${message.id}`} className="cb-msg__bubble">
                          {community && !grouped && !message.deleted ? (
                            <div className="cb-msg__author">
                              <span className="cb-msg__avatar is-teacher">{(message.author_label || "?").slice(0, 1)}</span>
                              <strong>{message.author_label}</strong>
                              <time>{formatClock(message.created_at)}</time>
                            </div>
                          ) : null}
                          {message.deleted ? <p className="is-deleted">Сообщение удалено</p> : (
                            <>
                              {message.reply_to ? (
                                <button type="button" className="cb-msg__quote" onClick={() => document.getElementById(`cb-msg-${message.reply_to.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                                  <strong>{message.reply_to.author_label}</strong>
                                  <span>{message.reply_to.excerpt}</span>
                                </button>
                              ) : null}
                              {message.text ? <p>{message.text}</p> : null}
                              {message.attachments?.map((file) => (
                                file.is_image ? (
                                  <a key={file.id} className="cb-msg__image" href={attachmentUrl(file.id)} target="_blank" rel="noreferrer">
                                    <img src={attachmentUrl(file.id)} alt={file.name} />
                                  </a>
                                ) : (
                                  <a key={file.id} className="cb-msg__file" href={attachmentUrl(file.id)}>
                                    <span>{file.name}</span>
                                    <small>{formatSize(file.size)}</small>
                                  </a>
                                )
                              ))}
                            </>
                          )}
                          {community && !message.deleted ? (
                            <div className="cb-msg__reactions">
                              {(message.reactions || []).map((item) => (
                                <button key={item.emoji} type="button" className={item.mine ? "is-mine" : ""} title={(item.users || []).map((user) => user.name).join(", ")} onClick={async () => {
                                  const data = await reactToMessage(activeId, message.id, item.emoji);
                                  setMessages((current) => current.map((row) => (row.id === data.message.id ? data.message : row)));
                                }}>
                                  {item.emoji} {item.count}
                                </button>
                              ))}
                              <span className="cb-msg__react-add">
                                {REACTIONS.map((emoji) => (
                                  <button key={emoji} type="button" onClick={async () => {
                                    const data = await reactToMessage(activeId, message.id, emoji);
                                    setMessages((current) => current.map((row) => (row.id === data.message.id ? data.message : row)));
                                  }}>{emoji}</button>
                                ))}
                              </span>
                            </div>
                          ) : null}
                          <div className="cb-msg__bubble-meta">
                            <span>{formatClock(message.created_at)}</span>
                            {message.edited_at && !message.deleted ? <span>изменено</span> : null}
                            {message.is_own ? <Checks status={message.delivery_status} /> : null}
                            {!message.deleted ? (
                              <button type="button" className="cb-msg__more" aria-label="Действия" onClick={() => { setMenuId(menuId === message.id ? null : message.id); setConfirmDeleteId(null); }}>⋯</button>
                            ) : null}
                          </div>
                          {menuId === message.id ? (
                            <div className="cb-msg__menu cb-msg__menu--bubble">
                              {active.type !== "developer" || !message.reply_disabled ? (
                                <button type="button" onClick={() => { setReplyTo(message); setEditing(null); setMenuId(null); composerRef.current?.focus(); }}>Ответить</button>
                              ) : null}
                              {message.can_edit ? (
                                <button type="button" onClick={() => { setEditing(message); setReplyTo(null); setText(message.text || ""); setMenuId(null); composerRef.current?.focus(); }}>Редактировать</button>
                              ) : null}
                              {message.can_pin ? (
                                <button type="button" onClick={async () => {
                                  const data = await pinCommunityMessage(activeId, message.id, !message.pinned);
                                  setMessages((current) => current.map((item) => (item.id === data.message.id ? data.message : item)));
                                  fetchCommunity(activeId).then(setCommunityInfo).catch(() => null);
                                  setMenuId(null);
                                }}>{message.pinned ? "Открепить" : "Закрепить"}</button>
                              ) : null}
                              {message.can_report ? (
                                <button type="button" onClick={() => { setReportFor(message); setMenuId(null); }}>Пожаловаться</button>
                              ) : null}
                              {message.can_delete ? (
                                confirmDeleteId === message.id ? (
                                  <button type="button" onClick={() => removeMessage(message.id)}>Удалить окончательно</button>
                                ) : (
                                  <button type="button" onClick={() => setConfirmDeleteId(message.id)}>Удалить</button>
                                )
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      </div>
                    )}
                  </div>
                );
              })}
              {peerTyping ? <p className="cb-msg__typing-line">печатает…</p> : null}
            </div>
            <div className="cb-msg__composer-wrap">
              {editing ? (
                <div className="cb-msg__reply">
                  <div><strong>Редактирование</strong><span>Можно изменить в течение 15 минут</span></div>
                  <button type="button" onClick={() => { setEditing(null); setText(""); }} aria-label="Отменить">×</button>
                </div>
              ) : null}
              {replyTo ? (
                <div className="cb-msg__reply">
                  <div>
                    <strong>Ответ на сообщение</strong>
                    <span>{replyTo.author_label}: {(replyTo.text || replyTo.excerpt || "").slice(0, 120)}</span>
                  </div>
                  <button type="button" onClick={() => setReplyTo(null)} aria-label="Отменить ответ">×</button>
                </div>
              ) : null}
              {files.length ? (
                <div className="cb-msg__previews">
                  {files.map((item) => (
                    <div key={item.url || item.file.name} className="cb-msg__preview-card">
                      {item.url ? <img src={item.url} alt="" /> : null}
                      <div>
                        <strong>{item.file.name}</strong>
                        <span>{fileKind(item.file)} · {formatSize(item.file.size)}</span>
                      </div>
                      <button type="button" aria-label="Убрать файл" onClick={() => {
                        if (item.url) URL.revokeObjectURL(item.url);
                        setFiles((current) => current.filter((file) => file !== item));
                      }}>×</button>
                    </div>
                  ))}
                </div>
              ) : null}
              <form className="cb-msg__composer" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
                <label className="cb-msg__attach" title="Прикрепить файл">
                  <IconAttach />
                  <input
                    type="file"
                    accept={FILE_ACCEPT}
                    multiple
                    disabled={composerLocked || Boolean(editing)}
                    onChange={(event) => {
                      const next = [...event.target.files].map((file) => ({
                        file,
                        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
                      }));
                      setFiles((current) => [...current, ...next]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {active?.type === "community" && /(?:^|\s)@([^\s@]*)$/.test(text) ? (
                  <div className="cb-msg__mentions">
                    {(communityInfo?.members || [])
                      .filter((item) => item.name.toLowerCase().includes((text.match(/@([^\s@]*)$/)?.[1] || "").toLowerCase()))
                      .slice(0, 6)
                      .map((item) => (
                        <button key={item.user_id} type="button" onClick={() => {
                          const next = text.replace(/@([^\s@]*)$/, `@${item.name} `);
                          setText(next);
                          setMentions((current) => current.some((row) => row.user_id === item.user_id) ? current : [...current, item]);
                          composerRef.current?.focus();
                        }}>{item.name}</button>
                      ))}
                  </div>
                ) : null}
                <textarea
                  ref={composerRef}
                  value={text}
                  rows={1}
                  disabled={composerLocked}
                  placeholder={
                    historyOnly
                      ? "Историю можно читать. Новые сообщения недоступны."
                      : composerLocked
                        ? "Ответ доступен только на отдельные сообщения"
                        : "Напишите сообщение…"
                  }
                  onChange={(event) => {
                    const next = event.target.value;
                    setText(next);
                    if (!editing && activeId) window.localStorage.setItem(`msg-draft:${activeId}`, next);
                    noteTyping(Boolean(next.trim()));
                  }}
                  onKeyDown={onComposerKey}
                />
                <button type="submit" className="cb-msg__send" disabled={sending || composerLocked || (!text.trim() && files.length === 0)} aria-label={sending ? "Отправляется" : "Отправить"}>
                  <IconSend />
                </button>
              </form>
              <div className="cb-msg__note">
                <span>{sending ? "Сообщение отправляется…" : "Enter — отправить · Shift+Enter — новая строка"}</span>
              </div>
              {error ? (
                <p className="cb-msg__error">
                  {error}{" "}
                  {blockedSend ? (
                    <button type="button" onClick={() => { setError(""); composerRef.current?.focus(); }}>Исправить сообщение</button>
                  ) : (
                    <button type="button" onClick={submitMessage}>Повторить</button>
                  )}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="cb-msg__quiet cb-msg__quiet--pane">
            <p>Здесь появятся ваши сообщения</p>
            <button type="button" onClick={() => setPickerOpen(true)}>Написать сообщение</button>
          </div>
        )}
        {infoOpen && communityInfo ? (
          <CommunityInfo
            info={communityInfo}
            onClose={() => setInfoOpen(false)}
            onChanged={(next) => { if (next) setCommunityInfo(next); loadList().catch(() => null); }}
            onLeft={() => { setInfoOpen(false); setActiveId(null); loadList().catch(() => null); }}
          />
        ) : null}
        {manageOpen ? (
          <CommunityAdmin
            onClose={() => setManageOpen(false)}
            onOpen={(conversationId) => { setManageOpen(false); setActiveId(conversationId); loadList().catch(() => null); }}
          />
        ) : null}
        {reportFor ? (
          <form className="cb-msg__report" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await reportCommunityMessage(activeId, reportFor.id, form.get("reason"), form.get("comment"));
            setReportFor(null);
          }}>
            <strong>Пожаловаться</strong>
            <select name="reason" defaultValue="spam">
              <option value="spam">Спам</option>
              <option value="insult">Оскорбление</option>
              <option value="inappropriate">Неподходящий контент</option>
              <option value="other">Другое</option>
            </select>
            <textarea name="comment" rows={3} placeholder="Комментарий" />
            <div>
              <button type="submit">Отправить</button>
              <button type="button" onClick={() => setReportFor(null)}>Отмена</button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
