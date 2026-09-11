export function latestInviteForStudent(student, invitations = []) {
  const id = Number(student?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const matches = invitations.filter((invite) => Number(invite?.pre_student) === id);
  if (!matches.length) return null;
  return matches.slice().sort((a, b) => {
    const aTime = Date.parse(a.created_at || "") || 0;
    const bTime = Date.parse(b.created_at || "") || 0;
    return bTime - aTime;
  })[0];
}

export function studentConnectionMeta(student, invite = null) {
  if (student?.raw?.status === "paused" || student?.status === "warning") {
    return { text: "На паузе", mod: "paused" };
  }
  if (student?.raw?.is_registered) {
    return { text: "Подключён", mod: "joined" };
  }
  if (invite?.status === "expired") {
    return { text: "Ссылка истекла", mod: "expired" };
  }
  return { text: "Приглашение не принято", mod: "pending" };
}

export function studentInviteMenuItems(student, invite, {
  onCopy,
  onResend,
  onRenew,
  copiedInviteId,
} = {}) {
  if (!student || student.raw?.is_registered) return [];
  if (invite?.status === "pending") {
    return [
      {
        label: copiedInviteId === invite.id ? "Скопировано" : "Скопировать ссылку",
        onClick: () => onCopy?.(invite),
      },
      {
        label: "Отправить повторно",
        onClick: () => onResend?.(invite),
      },
    ];
  }
  if (invite?.status === "expired") {
    return [
      {
        label: "Создать новую ссылку",
        onClick: () => onRenew?.(invite, student),
      },
    ];
  }
  if (student.id) {
    return [
      {
        label: "Создать новую ссылку",
        onClick: () => onRenew?.(invite, student),
      },
    ];
  }
  return [];
}
