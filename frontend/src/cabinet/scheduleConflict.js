export function savedEventWhen(event) {
  if (!event) return "нет данных";
  const date = String(event.startsAt || "").slice(0, 10);
  const time = event.startTime || "";
  const label = [date, time].filter(Boolean).join(" ");
  return label || "нет данных";
}

export function expectedUpdatedAtForWrite(event, conflict) {
  const serverStamp = conflict?.serverEvent?.updatedAt;
  if (serverStamp) return serverStamp;
  return event?.updatedAt || "";
}

export function scheduleConflictMessage(conflict, pending) {
  const saved = savedEventWhen(conflict?.serverEvent);
  const mine = [pending?.targetDate, pending?.targetStartTime].filter(Boolean).join(" ");
  return {
    title: "Занятие уже изменили",
    saved,
    mine: mine || "не указано",
    text: conflict?.message
      || "Это занятие уже изменили в другой вкладке. Сравните версии и повторите правку, если она всё ещё нужна.",
  };
}
