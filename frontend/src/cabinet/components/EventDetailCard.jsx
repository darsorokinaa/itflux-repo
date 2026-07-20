import { useEffect, useState } from "react";
import CabinetIcon from "../CabinetIcons";

const RESOURCE_PREVIEW = 2;

function participantInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function resourceIconName(row) {
  const kind = row.kind || "";
  if (kind === "notes") return "note";
  if (kind === "interactive" || kind === "lesson") return "interactives";
  if (kind === "variant" || kind === "task") return "tasks";
  if (kind === "file") return "folder";
  return "book";
}

function resourceCountMeta(count, variant) {
  if (count <= 0) return "";
  if (variant === "homework") {
    if (count === 1) return "1 элемент";
    if (count >= 2 && count <= 4) return `${count} элемента`;
    return `${count} элементов`;
  }
  if (count === 1) return "1 материал";
  if (count >= 2 && count <= 4) return `${count} материала`;
  return `${count} материалов`;
}

export function StatusBadge({ label, mod = "" }) {
  if (!label) return null;
  return (
    <span className={`cb-lesson-card__badge cb-lesson-card__badge--${mod}`}>
      {label}
    </span>
  );
}

function PassportTimeHero({ dateLabel, timeRange }) {
  const main = [dateLabel, timeRange].filter(Boolean).join(" · ");
  return (
    <div className="cb-lesson-card__passport-time">
      <span className="cb-lesson-card__passport-time-label">Время</span>
      <span className="cb-lesson-card__passport-time-main" title={main}>{main || "—"}</span>
    </div>
  );
}

function PassportMiniCell({ label, value, meta }) {
  const display = meta ? `${value} · ${meta}` : value;
  return (
    <div className="cb-lesson-card__passport-cell">
      <span className="cb-lesson-card__passport-label">{label}</span>
      <span className="cb-lesson-card__passport-value" title={display}>{display}</span>
    </div>
  );
}

function AboutField({ label, value }) {
  if (!value || !String(value).trim()) return null;
  return (
    <div className="cb-lesson-card__about-field">
      <span className="cb-lesson-card__about-label">{label}</span>
      <span className="cb-lesson-card__about-value">{value}</span>
    </div>
  );
}

function ParticipantChip({ participant }) {
  const role = participant.roleLabel || participant.name || "Участник";
  return (
    <span className="cb-lesson-card__participant" title={participant.name}>
      <span className="cb-lesson-card__participant-avatar" aria-hidden="true">
        {participantInitials(participant.name)}
      </span>
      <span className="cb-lesson-card__participant-role">{role}</span>
    </span>
  );
}

function ParticipantsRow({ participants }) {
  const list = Array.isArray(participants) ? participants : [];
  if (!list.length) return null;

  const visible = list.slice(0, 2);
  const rest = list.length - visible.length;

  return (
    <div className="cb-lesson-card__participants">
      {visible.map((participant, index) => (
        <ParticipantChip
          key={`${participant.role}-${participant.name}-${index}`}
          participant={participant}
        />
      ))}
      {rest > 0 ? (
        <span className="cb-lesson-card__participant cb-lesson-card__participant--more">
          + ещё {rest}
        </span>
      ) : null}
    </div>
  );
}

function SectionHead({ title, count, variant = "material" }) {
  return (
    <div className="cb-lesson-card__section-head">
      <h3 className="cb-lesson-card__section-title">
        <span className="cb-lesson-card__section-title-text">{title}</span>
        {count > 0 ? (
          <span className={`cb-lesson-card__count-badge cb-lesson-card__count-badge--${variant}`}>
            {count}
          </span>
        ) : null}
      </h3>
      {count > 0 ? (
        <span className="cb-lesson-card__section-meta">{resourceCountMeta(count, variant)}</span>
      ) : null}
    </div>
  );
}

function ResourceCard({ row, variant = "material" }) {
  const external = row.url && /^https?:\/\//.test(row.url);
  const isNotes = row.kind === "notes";
  return (
    <li className={`cb-lesson-card__resource cb-lesson-card__resource--${variant}${isNotes ? " cb-lesson-card__resource--notes" : ""}`}>
      <span className="cb-lesson-card__resource-icon" aria-hidden="true">
        <CabinetIcon name={resourceIconName(row)} />
      </span>
      <div className="cb-lesson-card__resource-body">
        <span className="cb-lesson-card__resource-title" title={row.label}>{row.label}</span>
        {row.typeLabel && !isNotes ? (
          <span className="cb-lesson-card__resource-type">{row.typeLabel}</span>
        ) : null}
        {row.text && isNotes ? (
          <p className="cb-lesson-card__resource-note">{row.text}</p>
        ) : null}
      </div>
      {row.submitted ? (
        <span className="cb-lesson-card__resource-submitted">
          <CabinetIcon name="check" />
          Сдано
        </span>
      ) : row.url ? (
        <a
          href={row.url}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
          className="cb-lesson-card__resource-open"
        >
          Открыть
        </a>
      ) : null}
    </li>
  );
}

function CollapsibleBlock({ title, count, countVariant, isMobile, children, className = "" }) {
  const [open, setOpen] = useState(!isMobile);

  useEffect(() => {
    setOpen(!isMobile);
  }, [isMobile]);

  const head = (
    <SectionHead title={title} count={count} variant={countVariant || "material"} />
  );

  if (!isMobile) {
    return (
      <section className={`cb-lesson-card__section cb-lesson-card__section--compact ${className}`.trim()}>
        {head}
        {children}
      </section>
    );
  }

  return (
    <section className={`cb-lesson-card__accordion ${className}`.trim()}>
      <button
        type="button"
        className="cb-lesson-card__accordion-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="cb-lesson-card__accordion-trigger-main">
          <span className="cb-lesson-card__section-title-text">{title}</span>
          {count > 0 ? (
            <span className={`cb-lesson-card__count-badge cb-lesson-card__count-badge--${countVariant || "material"}`}>
              {count}
            </span>
          ) : null}
        </span>
        <span className={`cb-lesson-card__accordion-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>
      {open ? <div className="cb-lesson-card__accordion-body">{children}</div> : null}
    </section>
  );
}

function ResourceSection({
  title,
  rows,
  emptyLabel,
  emptyActionLabel,
  onEmptyAction,
  variant = "material",
  isMobile,
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, RESOURCE_PREVIEW);
  const hiddenCount = rows.length - RESOURCE_PREVIEW;
  const scrollable = rows.length > RESOURCE_PREVIEW && showAll;

  const content = rows.length ? (
    <>
      <ul
        className={[
          "cb-lesson-card__resources",
          scrollable ? "cb-lesson-card__resources--scroll" : "",
        ].filter(Boolean).join(" ")}
      >
        {visibleRows.map((row) => (
          <ResourceCard key={row.key} row={row} variant={variant} />
        ))}
      </ul>
      {hiddenCount > 0 && !showAll ? (
        <button
          type="button"
          className="cb-lesson-card__show-more"
          onClick={() => setShowAll(true)}
        >
          Показать ещё ({hiddenCount})
        </button>
      ) : null}
    </>
  ) : (
    <div className={`cb-lesson-card__empty cb-lesson-card__empty--${variant}`}>
      <p>{emptyLabel}</p>
      {onEmptyAction ? (
        <button type="button" className="cb-lesson-card__empty-btn" onClick={onEmptyAction}>
          {emptyActionLabel}
        </button>
      ) : null}
    </div>
  );

  return (
    <CollapsibleBlock
      title={title}
      count={rows.length}
      countVariant={variant}
      isMobile={isMobile}
      className={`cb-lesson-card__section--${variant}`}
    >
      {content}
    </CollapsibleBlock>
  );
}

function MoreMenu({ open, onClose, items, isMobile }) {
  if (!open) return null;
  const regular = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  return (
    <>
      <button type="button" className="cb-lesson-card__menu-backdrop" onClick={onClose} aria-label="Закрыть меню" />
      <div className={`cb-lesson-card__menu${isMobile ? " cb-lesson-card__menu--sheet" : ""}`} role="menu">
        {regular.map((item) => (
          <button
            key={item.label}
            type="button"
            className="cb-lesson-card__menu-item"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
        {danger.length ? <div className="cb-lesson-card__menu-divider" role="separator" /> : null}
        {danger.map((item) => (
          <button
            key={item.label}
            type="button"
            className="cb-lesson-card__menu-item cb-lesson-card__menu-item--danger"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

function ActionBar({
  readOnly,
  studentMode,
  assignmentId,
  isCancelled,
  isDone,
  hasMaterials,
  hasLink,
  starting,
  isMobile,
  onOpenLesson,
  onStartMeeting,
  onEdit,
  moreItems,
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  if (studentMode) {
    return (
      <footer className="cb-lesson-card__footer">
        <div className={`cb-lesson-card__footer-row${isMobile ? " cb-lesson-card__footer-row--mobile" : ""}`}>
          {assignmentId ? (
            <button
              type="button"
              className={`cb-lesson-card__btn cb-lesson-card__btn--primary${isMobile ? " cb-lesson-card__btn--wide" : ""}`}
              onClick={onOpenLesson}
            >
              {isDone && hasMaterials ? "Открыть материалы" : "Открыть урок"}
            </button>
          ) : null}
          {hasLink ? (
            <button
              type="button"
              className="cb-lesson-card__btn cb-lesson-card__btn--secondary"
              onClick={onStartMeeting}
            >
              Подключиться
            </button>
          ) : null}
        </div>
      </footer>
    );
  }

  if (readOnly) {
    return (
      <footer className="cb-lesson-card__footer">
        <a
          href="https://calendar.yandex.ru/"
          target="_blank"
          rel="noopener noreferrer"
          className="cb-lesson-card__btn cb-lesson-card__btn--primary cb-lesson-card__btn--wide"
        >
          Яндекс Календарь
        </a>
      </footer>
    );
  }

  return (
    <footer className="cb-lesson-card__footer">
      <div className={`cb-lesson-card__footer-row${isMobile ? " cb-lesson-card__footer-row--mobile" : ""}`}>
        <button
          type="button"
          className={`cb-lesson-card__btn cb-lesson-card__btn--primary${isMobile ? " cb-lesson-card__btn--wide" : ""}`}
          onClick={onOpenLesson}
        >
          {isDone && hasMaterials ? "Открыть материалы" : "Открыть урок"}
        </button>
        {hasLink ? (
          <button
            type="button"
            className="cb-lesson-card__btn cb-lesson-card__btn--secondary"
            disabled={starting}
            onClick={onStartMeeting}
          >
            {starting ? "Подключение…" : "Начать встречу"}
          </button>
        ) : null}
        {!isMobile ? (
          <>
            {!isCancelled ? (
              <button type="button" className="cb-lesson-card__btn cb-lesson-card__btn--ghost" onClick={onEdit}>
                Редактировать
              </button>
            ) : null}
            <div className="cb-lesson-card__more-wrap">
              <button
                type="button"
                className="cb-lesson-card__btn cb-lesson-card__btn--ghost"
                onClick={() => setMoreOpen((value) => !value)}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
              >
                Ещё
              </button>
              <MoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} isMobile={false} />
            </div>
          </>
        ) : null}
      </div>
      {isMobile && !isCancelled ? (
        <div className="cb-lesson-card__footer-row cb-lesson-card__footer-row--mobile-sub">
          <button type="button" className="cb-lesson-card__btn cb-lesson-card__btn--ghost" onClick={onEdit}>
            Редактировать
          </button>
          <div className="cb-lesson-card__more-wrap">
            <button
              type="button"
              className="cb-lesson-card__btn cb-lesson-card__btn--ghost"
              onClick={() => setMoreOpen((value) => !value)}
              aria-expanded={moreOpen}
            >
              Ещё
            </button>
            <MoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} isMobile />
          </div>
        </div>
      ) : null}
    </footer>
  );
}

export default function EventDetailCard({
  event,
  isMobile,
  studentMode = false,
  assignmentId = null,
  typeLabel,
  accentColor,
  profileName,
  dateLabel,
  timeRange,
  statusMeta,
  recurring,
  isOnline,
  isCancelled,
  isDone,
  canStart,
  hasLink,
  hasMeetingLinkPending = false,
  canEditLink,
  materials,
  homework,
  planItem,
  hasAbout,
  topic,
  participants,
  participantsFallback,
  shortenMeetingUrl,
  onClose,
  onEdit,
  onOpenLesson,
  onAddMaterials,
  onAddHomework,
  onStart,
  onRequestDelete,
  onRequestCancel,
  onDuplicate,
  onSaveLink,
  savingLinkId,
  startingId,
}) {
  const [linkDraft, setLinkDraft] = useState(event.link || "");
  const [copied, setCopied] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    setLinkDraft(event.link || "");
    setCopied(false);
  }, [event.id, event.link]);

  const handleCopyLink = async () => {
    if (!event.link) return;
    try {
      await navigator.clipboard.writeText(event.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleStartMeeting = () => {
    const link = event.videoMeeting?.pageUrl || event.link || "";
    const isInternalJitsi = typeof link === "string" && link.startsWith("/cabinet/meetings/");
    // Внешний Телемост — новая вкладка; Jitsi и создание комнаты — через onStart.
    if (hasLink && link && !isInternalJitsi && !event.videoMeeting?.uuid) {
      window.open(link, "_blank", "noopener,noreferrer");
      return;
    }
    onStart(event);
  };

  const headerTitle = topic?.trim() || typeLabel;
  const subtitleParts = topic?.trim()
    ? [typeLabel, profileName].filter(Boolean)
    : [profileName].filter(Boolean);
  const subtitle = studentMode
    ? (profileName || "")
    : subtitleParts.join(" · ");

  const courseTitle = planItem?.planTitle || "";
  const subtopic = planItem?.subtopic || "";
  const taskNumber = planItem?.taskNumber || "";
  const showAbout = courseTitle || subtopic || taskNumber;

  const participantList = Array.isArray(participants) ? participants : [];
  const participantCount = participantList.length
    ? String(participantList.length)
    : (participantsFallback && participantsFallback !== "—" ? "1" : "—");

  const formatValue = isOnline ? "Онлайн" : "Офлайн";
  const formatMeta = isOnline
    ? (isDone
      ? "Проведено"
      : (event.videoMeeting || event.meetingProvider === "jitsi")
        ? "Jitsi"
        : hasLink
          ? "Телемост"
          : (studentMode && hasMeetingLinkPending ? "Скоро" : "Без ссылки"))
    : null;

  const showStatusBadge = !studentMode && statusMeta && ["moved", "cancelled", "done"].includes(statusMeta.mod);

  const moreItems = isCancelled
    ? [{ label: "Удалить", danger: true, onClick: onRequestDelete }]
    : [
        { label: "Перенести", onClick: onEdit },
        { label: "Отменить", danger: true, onClick: onRequestCancel },
        { label: "Дублировать", onClick: onDuplicate },
        { label: "Удалить", danger: true, onClick: onRequestDelete },
      ];

  const overlayClass = [
    "cb-sch-overlay",
    "cb-sch-overlay--lesson",
    isMobile ? "cb-sch-overlay--sheet" : "",
  ].filter(Boolean).join(" ");

  const cardClass = [
    "cb-sch-popover",
    "cb-lesson-card",
    !studentMode && statusMeta ? `cb-lesson-card--${statusMeta.mod}` : "",
  ].filter(Boolean).join(" ");

  const openLesson = () => onOpenLesson(Boolean(isDone && materials.length));
  const handleAddMaterials = () => {
    if (onAddMaterials) {
      onAddMaterials(event);
      return;
    }
    onOpenLesson?.(true);
  };
  const handleAddHomework = () => {
    if (onAddHomework) {
      onAddHomework(event);
      return;
    }
    onOpenLesson?.(true);
  };

  return (
    <div className={overlayClass} onClick={onClose} role="presentation">
      <div
        className={cardClass}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sch-lesson-title"
      >
        <header className="cb-lesson-card__header">
          <div className="cb-lesson-card__header-main">
            <span
              className="cb-lesson-card__type-dot"
              style={{ background: accentColor || "#2563EB" }}
              aria-hidden="true"
            />
            <div className="cb-lesson-card__header-text">
              <h2 id="sch-lesson-title" className="cb-lesson-card__title">{headerTitle}</h2>
              {subtitle ? <p className="cb-lesson-card__subtitle">{subtitle}</p> : null}
              {(showStatusBadge || (!studentMode && (recurring || isOnline))) ? (
                <div className="cb-lesson-card__badges">
                  {showStatusBadge ? (
                    <StatusBadge label={statusMeta.label} mod={statusMeta.mod} />
                  ) : null}
                  {!studentMode && recurring ? <StatusBadge label="Повторяется" mod="recurring" /> : null}
                  {!studentMode && isOnline ? <StatusBadge label="Онлайн" mod="online" /> : null}
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </header>

        <div className="cb-lesson-card__body">
          <div className="cb-lesson-card__grid">
            <div className="cb-lesson-card__col cb-lesson-card__col--main">
              <div className="cb-lesson-card__passport">
                <PassportTimeHero dateLabel={dateLabel} timeRange={timeRange} />
                <div className="cb-lesson-card__passport-mini">
                  <PassportMiniCell label="Формат" value={formatValue} meta={formatMeta} />
                  <PassportMiniCell label="Тип" value={typeLabel || "—"} />
                  <PassportMiniCell label="Участники" value={participantCount} />
                </div>
              </div>

              {showAbout ? (
                <section className="cb-lesson-card__section cb-lesson-card__section--compact cb-lesson-card__section--about">
                  <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">О занятии</h3>
                  <div className="cb-lesson-card__about">
                    <AboutField label="Курс" value={courseTitle} />
                    <AboutField label="Подтема" value={subtopic} />
                    <AboutField label="№ задания" value={taskNumber} />
                  </div>
                </section>
              ) : null}

              <ParticipantsRow participants={participantList} />

              {isOnline ? (
                <section className="cb-lesson-card__meeting-wrap">
                  <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">Онлайн-встреча</h3>
                  <div className="cb-lesson-card__meeting">
                    {hasLink ? (
                      <>
                        <div className="cb-lesson-card__meeting-info">
                          <span className="cb-lesson-card__meeting-provider">Телемост</span>
                          <span className="cb-lesson-card__meeting-url" title={event.link}>
                            {shortenMeetingUrl(event.link)}
                          </span>
                        </div>
                        <div className="cb-lesson-card__meeting-actions">
                          <button
                            type="button"
                            className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                            onClick={handleStartMeeting}
                          >
                            Начать
                          </button>
                          <button type="button" className="cb-lesson-card__meeting-btn" onClick={handleCopyLink}>
                            {copied ? "Скопировано" : "Скопировать"}
                          </button>
                        </div>
                      </>
                    ) : studentMode && hasMeetingLinkPending && !isDone ? (
                      <p className="cb-lesson-card__meeting-empty">
                        Подключение откроется за 5 минут до начала
                      </p>
                    ) : (
                      <>
                        <p className="cb-lesson-card__meeting-empty">Ссылка не добавлена</p>
                        {canEditLink ? (
                          <div className="cb-lesson-card__link-form">
                            <input
                              type="url"
                              value={linkDraft}
                              onChange={(e) => setLinkDraft(e.target.value)}
                              placeholder="https://telemost.yandex.ru/j/…"
                              aria-label="Ссылка на встречу"
                            />
                            <button
                              type="button"
                              className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                              disabled={savingLinkId === event.id}
                              onClick={() => onSaveLink(event, linkDraft.trim())}
                            >
                              {savingLinkId === event.id ? "…" : "Добавить ссылку"}
                            </button>
                          </div>
                        ) : canStart ? (
                          <button
                            type="button"
                            className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                            disabled={startingId === event.id}
                            onClick={() => onStart(event)}
                          >
                            {startingId === event.id ? "…" : "Добавить ссылку"}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </section>
              ) : null}

              {hasAbout ? (
                isMobile ? (
                  <section className="cb-lesson-card__accordion">
                    <button
                      type="button"
                      className="cb-lesson-card__accordion-trigger"
                      onClick={() => setNotesOpen((value) => !value)}
                      aria-expanded={notesOpen}
                    >
                      <span>Заметки</span>
                      <span className={`cb-lesson-card__accordion-chevron${notesOpen ? " is-open" : ""}`} aria-hidden="true" />
                    </button>
                    {notesOpen ? (
                      <div className="cb-lesson-card__accordion-body">
                        <div className="cb-lesson-card__notes">
                          {planItem?.goal ? (
                            <div className="cb-lesson-card__note">
                              <span className="cb-lesson-card__note-label">Цель</span>
                              <p>{planItem.goal}</p>
                            </div>
                          ) : null}
                          {planItem?.description ? (
                            <div className="cb-lesson-card__note">
                              <span className="cb-lesson-card__note-label">План</span>
                              <p>{planItem.description}</p>
                            </div>
                          ) : null}
                          {planItem?.teacherComment ? (
                            <div className="cb-lesson-card__note">
                              <span className="cb-lesson-card__note-label">Комментарий</span>
                              <p>{planItem.teacherComment}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <section className="cb-lesson-card__section cb-lesson-card__section--compact cb-lesson-card__section--notes">
                    <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">Заметки</h3>
                    <div className="cb-lesson-card__notes cb-lesson-card__notes--scroll">
                      {planItem?.goal ? (
                        <div className="cb-lesson-card__note">
                          <span className="cb-lesson-card__note-label">Цель</span>
                          <p>{planItem.goal}</p>
                        </div>
                      ) : null}
                      {planItem?.description ? (
                        <div className="cb-lesson-card__note">
                          <span className="cb-lesson-card__note-label">План</span>
                          <p>{planItem.description}</p>
                        </div>
                      ) : null}
                      {planItem?.teacherComment ? (
                        <div className="cb-lesson-card__note">
                          <span className="cb-lesson-card__note-label">Комментарий</span>
                          <p>{planItem.teacherComment}</p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                )
              ) : null}
            </div>

            <div className="cb-lesson-card__col cb-lesson-card__col--side">
              <ResourceSection
                title="Материалы урока"
                rows={materials}
                emptyLabel="Материалов нет"
                emptyActionLabel="Добавить"
                onEmptyAction={event.readOnly || studentMode ? null : handleAddMaterials}
                variant="material"
                isMobile={isMobile}
              />

              <ResourceSection
                title="Домашнее задание"
                rows={homework}
                emptyLabel="Домашнее задание не выдано"
                emptyActionLabel="Добавить ДЗ"
                onEmptyAction={event.readOnly || studentMode ? null : handleAddHomework}
                variant="homework"
                isMobile={isMobile}
              />
            </div>
          </div>
        </div>

        <ActionBar
          readOnly={event.readOnly}
          studentMode={studentMode}
          assignmentId={assignmentId}
          isCancelled={isCancelled}
          isDone={isDone}
          hasMaterials={materials.length > 0}
          hasLink={hasLink}
          starting={startingId === event.id}
          isMobile={isMobile}
          onOpenLesson={openLesson}
          onStartMeeting={handleStartMeeting}
          onEdit={onEdit}
          moreItems={moreItems}
        />
      </div>
    </div>
  );
}
