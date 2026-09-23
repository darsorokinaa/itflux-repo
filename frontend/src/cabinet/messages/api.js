async function ensureCsrf() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  await fetch("/api/csrf/", { credentials: "same-origin", cache: "no-store" });
  const again = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return again ? decodeURIComponent(again[1]) : "";
}

async function parse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error(data?.detail || "Не удалось выполнить запрос");
    error.status = res.status;
    error.code = data?.code || "";
    error.reason = data?.reason || "";
    error.data = data;
    throw error;
  }
  return data;
}

async function messagingFetch(path, { method = "GET", json, form } = {}) {
  const headers = { Accept: "application/json" };
  const csrf = await ensureCsrf();
  if (csrf) headers["X-CSRFToken"] = csrf;
  let body;
  if (form) {
    body = form;
  } else if (json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await fetch(`/api/cabinet/messages${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body,
  });
  return parse(res);
}

export function fetchMessageConversations() {
  return messagingFetch("/conversations/");
}

export function fetchContacts(query = "") {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const suffix = params.toString() ? `?${params}` : "";
  return messagingFetch(`/contacts/${suffix}`);
}

export function openDirectConversation(userId) {
  return messagingFetch("/conversations/direct/", {
    method: "POST",
    json: { user_id: userId },
  });
}

export function fetchMessageUnread() {
  return messagingFetch("/unread-count/");
}

export function fetchMessages(conversationId, params = {}) {
  const query = new URLSearchParams();
  if (params.before) query.set("before", String(params.before));
  if (params.after) query.set("after", String(params.after));
  if (params.q) query.set("q", params.q);
  if (params.author) query.set("author", String(params.author));
  if (params.hasFiles) query.set("has_files", "1");
  if (params.date) query.set("date", params.date);
  const suffix = query.toString() ? `?${query}` : "";
  return messagingFetch(`/conversations/${conversationId}/messages/${suffix}`);
}

export function searchMessages(q) {
  return messagingFetch(`/search/?q=${encodeURIComponent(q)}`);
}

export function sendMessage(conversationId, { text, replyTo, clientMessageId, files, library, mentionUserIds }) {
  const mentions = (mentionUserIds || []).join(",");
  const cards = library || [];
  if (files?.length) {
    const form = new FormData();
    form.set("text", text || "");
    if (replyTo) form.set("reply_to", String(replyTo));
    if (clientMessageId) form.set("client_message_id", clientMessageId);
    if (mentions) form.set("mention_user_ids", mentions);
    if (cards.length) form.set("library", JSON.stringify(cards));
    for (const file of files) form.append("files", file);
    return messagingFetch(`/conversations/${conversationId}/messages/`, { method: "POST", form });
  }
  return messagingFetch(`/conversations/${conversationId}/messages/`, {
    method: "POST",
    json: {
      text,
      reply_to: replyTo || null,
      client_message_id: clientMessageId || "",
      mention_user_ids: mentionUserIds || [],
      library: cards,
    },
  });
}

export function createSupportTicket({ category, subject, text, files }) {
  const form = new FormData();
  form.set("category", category);
  form.set("subject", subject);
  form.set("text", text);
  form.set("client_message_id", crypto.randomUUID());
  for (const file of files || []) form.append("files", file);
  return messagingFetch("/support/tickets/", { method: "POST", form });
}

export function editMessage(conversationId, messageId, text) {
  return messagingFetch(`/conversations/${conversationId}/messages/${messageId}/`, {
    method: "PATCH",
    json: { text },
  });
}

export function deleteMessage(conversationId, messageId) {
  return messagingFetch(`/conversations/${conversationId}/messages/${messageId}/`, {
    method: "DELETE",
  });
}

export function markMessagesRead(conversationId, messageId) {
  return messagingFetch(`/conversations/${conversationId}/read/`, {
    method: "POST",
    json: { message_id: messageId },
  });
}

export function markMessagesDelivered(conversationId, messageId) {
  return messagingFetch(`/conversations/${conversationId}/delivered/`, {
    method: "POST",
    json: { message_id: messageId },
  });
}

export function attachmentUrl(id) {
  return `/api/cabinet/messages/attachments/${id}/`;
}

export function previewCommunityInvite(token) {
  return messagingFetch(`/community-invites/${encodeURIComponent(token)}/`);
}

export function acceptCommunityInvite(body) {
  return messagingFetch("/community-invites/accept/", { method: "POST", json: body });
}

export function declineCommunityInvite(body) {
  return messagingFetch("/community-invites/decline/", { method: "POST", json: body });
}

export function fetchCommunity(conversationId) {
  return messagingFetch(`/conversations/${conversationId}/community/`);
}

export function fetchCommunities() {
  return messagingFetch("/communities/");
}

export function createCommunity(fields) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value != null && value !== "") form.set(key, value);
  });
  return messagingFetch("/communities/", { method: "POST", form });
}

export function updateCommunity(conversationId, fields, form) {
  if (form) {
    return messagingFetch(`/conversations/${conversationId}/community/`, { method: "PATCH", form });
  }
  return messagingFetch(`/conversations/${conversationId}/community/`, { method: "PATCH", json: fields });
}

export function inviteToCommunity(conversationId, body) {
  return messagingFetch(`/conversations/${conversationId}/invites/`, { method: "POST", json: body });
}

export function leaveCommunity(conversationId) {
  return messagingFetch(`/conversations/${conversationId}/leave/`, { method: "POST", json: {} });
}

export function setCommunityNotifications(conversationId, body) {
  return messagingFetch(`/conversations/${conversationId}/notifications/`, { method: "POST", json: body });
}

export function communityMemberAction(conversationId, userId, body) {
  return messagingFetch(`/conversations/${conversationId}/members/${userId}/`, { method: "POST", json: body });
}

export function reactToMessage(conversationId, messageId, emoji) {
  return messagingFetch(`/conversations/${conversationId}/messages/${messageId}/reactions/`, {
    method: "POST",
    json: { emoji },
  });
}

export function pinCommunityMessage(conversationId, messageId, pinned) {
  return messagingFetch(`/conversations/${conversationId}/messages/${messageId}/pin/`, {
    method: "POST",
    json: { pinned },
  });
}

export function reportCommunityMessage(conversationId, messageId, reason, comment) {
  return messagingFetch(`/conversations/${conversationId}/messages/${messageId}/report/`, {
    method: "POST",
    json: { reason, comment },
  });
}

export function fetchConversationFiles(conversationId) {
  return messagingFetch(`/conversations/${conversationId}/files/`);
}

export const SUPPORT_CATEGORIES = [
  { value: "technical", label: "Техническая проблема" },
  { value: "billing", label: "Оплата и тариф" },
  { value: "materials", label: "Материалы и задания" },
  { value: "lesson", label: "Проведение урока" },
  { value: "account", label: "Аккаунт" },
  { value: "suggestion", label: "Предложение" },
  { value: "other", label: "Другое" },
];
