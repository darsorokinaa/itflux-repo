import { useEffect, useRef, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import { canFollowPeer, canGoToPeer } from "./boardFollow";
import type { CollabPeer } from "./boardCollab";

export type BoardPresencePerson = {
  key: string;
  name: string;
  initials: string;
  color: string;
  clientId: string | null;
  role?: string;
  isSelf?: boolean;
  online?: boolean;
};

type Props = {
  people: BoardPresencePerson[];
  selfRole?: string | null;
  followingName?: string;
  followingClientId?: string | null;
  compact?: boolean;
  onGoTo: (person: BoardPresencePerson) => void;
  onFollow: (person: BoardPresencePerson) => void;
  onStopFollow: () => void;
  onMyArea: () => void;
};

export function participantInitials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase("ru-RU");
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toLocaleUpperCase("ru-RU");
}

const AVATAR_PALETTE = [
  "#0f766e", "#1d4ed8", "#7c3aed", "#b45309", "#be123c", "#047857", "#0369a1",
];

export function avatarColor(name: string): string {
  const raw = String(name || "");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function peersToPresence(
  peers: CollabPeer[],
  opts: {
    selfName: string;
    selfRole?: string | null;
    fallbackOther?: string | null;
    ownerName?: string | null;
  },
): BoardPresencePerson[] {
  const inferRole = (name: string, role?: string) => {
    if (role) return role;
    if (opts.ownerName && name === opts.ownerName) return "teacher";
    if (opts.selfRole === "teacher") return "student";
    return undefined;
  };
  const self: BoardPresencePerson = {
    key: "self",
    name: opts.selfName,
    initials: participantInitials(opts.selfName),
    color: avatarColor(opts.selfName),
    clientId: null,
    role: opts.selfRole || undefined,
    isSelf: true,
    online: true,
  };
  const others: BoardPresencePerson[] = [];
  if (peers.length) {
    for (const peer of peers) {
      const name = peer.displayName || "Участник";
      others.push({
        key: peer.clientId,
        name,
        initials: participantInitials(name),
        color: avatarColor(name),
        clientId: peer.clientId,
        role: inferRole(name, peer.role),
        online: true,
      });
    }
  } else if (opts.fallbackOther && opts.fallbackOther !== opts.selfName) {
    others.push({
      key: "other",
      name: opts.fallbackOther,
      initials: participantInitials(opts.fallbackOther),
      color: avatarColor(opts.fallbackOther),
      clientId: null,
      role: inferRole(opts.fallbackOther, undefined),
      online: false,
    });
  }
  return [self, ...others];
}

function PeerMenu({
  person,
  selfRole,
  followingClientId,
  onGoTo,
  onFollow,
  onStopFollow,
  onClose,
}: {
  person: BoardPresencePerson;
  selfRole?: string | null;
  followingClientId?: string | null;
  onGoTo: (person: BoardPresencePerson) => void;
  onFollow: (person: BoardPresencePerson) => void;
  onStopFollow: () => void;
  onClose: () => void;
}) {
  const isFollowingThis = Boolean(person.clientId && followingClientId === person.clientId);
  const allowGo = !person.isSelf && canGoToPeer(selfRole, person.role);
  const allowFollow = !person.isSelf && Boolean(person.clientId) && canFollowPeer(selfRole, person.role);
  const teacherLabel = person.role === "teacher" || person.role === "owner";
  return (
    <div className="cb-board-peer-pop" role="menu">
      <p className="cb-board-peer-pop__name">{person.name}</p>
      {person.isSelf ? (
        <p className="cb-board-peer-pop__hint">Это вы</p>
      ) : null}
      {allowGo ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => { onGoTo(person); onClose(); }}
        >
          {teacherLabel ? "Перейти к учителю" : "Перейти к ученику"}
        </button>
      ) : null}
      {allowFollow && !isFollowingThis ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => { onFollow(person); onClose(); }}
        >
          {teacherLabel ? "Следить за учителем" : "Следить за учеником"}
        </button>
      ) : null}
      {isFollowingThis ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => { onStopFollow(); onClose(); }}
        >
          Остановить слежение
        </button>
      ) : null}
      {!person.isSelf && !allowGo && !allowFollow ? (
        <p className="cb-board-peer-pop__hint">{person.online ? "Подключён" : "Не в сети"}</p>
      ) : null}
    </div>
  );
}

export default function BoardCollabControls({
  people,
  selfRole,
  followingName,
  followingClientId,
  compact = false,
  onGoTo,
  onFollow,
  onStopFollow,
  onMyArea,
}: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onlineCount = people.filter((p) => p.online !== false).length;

  useEffect(() => {
    if (!openKey && !listOpen) return undefined;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenKey(null);
        setListOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openKey, listOpen]);

  const selected = people.find((p) => p.key === openKey) || null;

  return (
    <div className="cb-board-collab-ui" ref={rootRef}>
      {compact ? (
        <button
          type="button"
          className="cb-board-collab-ui__fab"
          aria-label="Участники"
          title="Показать всех участников"
          onClick={() => { setListOpen((v) => !v); setOpenKey(null); }}
        >
          <CabinetIcon name="users" />
          {onlineCount > 1 ? (
            <span className="cb-board-collab-ui__badge">{onlineCount}</span>
          ) : null}
        </button>
      ) : (
        <div className="cb-board-collab-ui__avatars" aria-label="Участники доски">
          {people.slice(0, 6).map((person) => (
            <button
              key={person.key}
              type="button"
              className={[
                "cb-board-editor__avatar",
                "cb-board-editor__avatar--clickable",
                person.online === false ? "is-offline" : "",
                followingClientId && person.clientId === followingClientId ? "is-followed" : "",
              ].filter(Boolean).join(" ")}
              style={{ backgroundColor: person.color }}
              title={person.isSelf ? `${person.name} (вы)` : person.name}
              aria-label={person.name}
              onClick={() => setOpenKey((prev) => (prev === person.key ? null : person.key))}
            >
              {person.initials}
            </button>
          ))}
        </div>
      )}

      {listOpen ? (
        <div className="cb-board-peer-sheet" role="dialog" aria-label="Участники">
          <p className="cb-board-peer-pop__name">Участники</p>
          {people.map((person) => (
            <button
              key={person.key}
              type="button"
              className="cb-board-peer-sheet__row"
              onClick={() => { setOpenKey(person.key); setListOpen(false); }}
            >
              <span className="cb-board-editor__avatar" style={{ backgroundColor: person.color }}>
                {person.initials}
              </span>
              <span>{person.isSelf ? `${person.name} (вы)` : person.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <PeerMenu
          person={selected}
          selfRole={selfRole}
          followingClientId={followingClientId || null}
          onGoTo={onGoTo}
          onFollow={onFollow}
          onStopFollow={onStopFollow}
          onClose={() => setOpenKey(null)}
        />
      ) : null}

      {followingName ? (
        <div className="cb-board-follow-chip">
          <CabinetIcon name="eye" />
          <span>{followingName}</span>
          <button
            type="button"
            className="cb-board-follow-chip__stop"
            aria-label="Остановить слежение"
            title="Остановить слежение"
            onClick={onStopFollow}
          >
            <CabinetIcon name="close" />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="cb-board-collab-ui__home"
        title="Вернуться к своей области"
        aria-label="Вернуться к своей области"
        onClick={onMyArea}
      >
        <CabinetIcon name="pointer" />
      </button>
    </div>
  );
}
