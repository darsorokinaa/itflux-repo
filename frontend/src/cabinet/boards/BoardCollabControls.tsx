import { useState } from "react";
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
  followingClientId?: string | null;
  canSummon?: boolean;
  onFollow: (person: BoardPresencePerson) => void;
  onStopFollow: () => void;
  onSummon?: () => void;
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

export function remoteFollowablePeople(people: BoardPresencePerson[]): BoardPresencePerson[] {
  return people.filter((person) => !person.isSelf && Boolean(person.clientId));
}

function followTooltip(name: string, followed: boolean): string {
  const label = String(name || "").trim() || "участником";
  return followed ? `Вы следите за ${label}` : `Следить за ${label}`;
}

const MAX_VISIBLE = 4;

export default function BoardCollabControls({
  people,
  followingClientId,
  canSummon = false,
  onFollow,
  onStopFollow,
  onSummon,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const remotes = remoteFollowablePeople(people);
  if (!remotes.length) return null;

  const self = people.find((person) => person.isSelf) || null;
  const showSummon = Boolean(canSummon && onSummon && self);
  const overflow = remotes.length > MAX_VISIBLE;
  const visible = expanded || !overflow ? remotes : remotes.slice(0, MAX_VISIBLE);
  const hiddenCount = remotes.length - MAX_VISIBLE;

  const toggleFollow = (person: BoardPresencePerson) => {
    if (!person.clientId) return;
    if (followingClientId === person.clientId) onStopFollow();
    else onFollow(person);
  };

  return (
    <div className="cb-board-collab-ui">
      <div className="cb-board-collab-ui__avatars">
        {visible.map((person) => {
          const followed = Boolean(person.clientId && followingClientId === person.clientId);
          const title = followTooltip(person.name, followed);
          return (
            <button
              key={person.key}
              type="button"
              className={[
                "cb-board-editor__avatar",
                "cb-board-editor__avatar--clickable",
                followed ? "is-followed" : "",
              ].filter(Boolean).join(" ")}
              style={{ backgroundColor: person.color }}
              title={title}
              aria-label={title}
              aria-pressed={followed}
              onClick={() => toggleFollow(person)}
            >
              {person.initials}
            </button>
          );
        })}
        {overflow && !expanded ? (
          <button
            type="button"
            className="cb-board-collab-ui__more"
            title={`Ещё ${hiddenCount}`}
            aria-label={`Ещё ${hiddenCount}`}
            onClick={() => setExpanded(true)}
          >
            +{hiddenCount}
          </button>
        ) : null}
        {showSummon && self ? (
          <button
            type="button"
            className="cb-board-editor__avatar cb-board-editor__avatar--clickable cb-board-collab-ui__self"
            style={{ backgroundColor: self.color }}
            title="Перенести ко мне"
            aria-label="Перенести ко мне"
            onClick={onSummon}
          >
            {self.initials}
          </button>
        ) : null}
      </div>
    </div>
  );
}
