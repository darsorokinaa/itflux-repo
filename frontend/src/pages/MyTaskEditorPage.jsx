import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import MathContent from "../components/MathContent";
import TaskFileAttachment from "../components/TaskFileAttachment";
import {
  TeacherTaskAnswerEditor,
  TeacherTaskPreviewMath,
  TeacherTaskRichEditor,
} from "../components/TeacherTaskRichEditor";
import { fetchCabinetSession } from "../utils/cabinetAuth";
import { fetchExamCatalog } from "../utils/examCatalog";
import { sanitizeTaskHtml } from "../utils/sanitizeTaskHtml";
import { useAccessGate } from "../hooks/useAccessGate";
import {
  createMyTask,
  deleteMyTaskAttachment,
  fetchMyTask,
  fetchMyTasksCatalog,
  fetchMyTasksMeta,
  mergeCatalogSubjects,
  updateMyTask,
  uploadMyTaskAttachment,
  uploadMyTaskImage,
} from "../utils/teacherTaskBankApi";
import { MyTaskBankShell } from "./MyTaskBankPage";
import "../styles/my-task-bank.css";
import "../styles/my-task-editor.css";

const DIFFICULTY_CHIPS = [
  { id: "novice", label: "Новичок" },
  { id: "confident", label: "Уверенный" },
  { id: "expert", label: "Эксперт" },
  { id: "old", label: "Старое" },
];

const DIFFICULTY_TITLES = {
  novice: "Новичок",
  confident: "Уверенный",
  expert: "Эксперт",
  old: "Старое",
};

function displayNameFromSession(session) {
  const user = session?.user || {};
  return [user.name, user.surname].filter(Boolean).join(" ").trim();
}

function previewMarkup(text) {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return raw
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function isExamLevel(level) {
  const slug = String(level || "").trim().toLowerCase();
  return slug === "ege" || slug === "oge";
}

function statusLabel(status) {
  if (status === "ready") return "Готово";
  if (status === "archived") return "Архив";
  return "Черновик";
}

function difficultyFromTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const byTitle = (title) => list.find((item) => String(item?.title || "") === title);
  if (byTitle("Старое")) return "old";
  if (byTitle("Эксперт")) return "expert";
  if (byTitle("Уверенный")) return "confident";
  if (byTitle("Новичок")) return "novice";
  const typed = list.find((item) => item?.type === "difficulty");
  if (typed?.title === "Эксперт") return "expert";
  if (typed?.title === "Уверенный") return "confident";
  if (typed?.title === "Новичок") return "novice";
  return "novice";
}

function extraTagIds(tags) {
  const skip = new Set(Object.values(DIFFICULTY_TITLES));
  return (Array.isArray(tags) ? tags : [])
    .filter((item) => item?.id && !skip.has(String(item.title || "")))
    .map((item) => Number(item.id))
    .filter(Boolean);
}

function tagIdForDifficulty(tags, chipId) {
  const title = DIFFICULTY_TITLES[chipId];
  if (!title) return null;
  const found = (tags || []).find((item) => String(item?.title || "") === title);
  return found?.id ? Number(found.id) : null;
}

function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toUpperCase() : "Файл";
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function AttachmentList({ items, onRemove }) {
  if (!items.length) return null;
  return (
    <ul className="mtb-attach-list">
      {items.map((item) => (
        <li key={item.key} className="mtb-attach-card">
          <div className="mtb-attach-card__text">
            <p className="mtb-attach-card__name">{item.name}</p>
            <p className="mtb-attach-card__meta">{fileExt(item.name)} · {formatSize(item.size)}</p>
          </div>
          <div className="mtb-attach-card__actions">
            {item.url ? (
              <a className="mtb-link-btn" href={item.url} target="_blank" rel="noreferrer">Открыть</a>
            ) : null}
            {onRemove ? (
              <button type="button" className="mtb-link-btn" onClick={() => onRemove(item)}>Удалить</button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PreviewBlobAttachment({ file, name }) {
  const href = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(href), [href]);
  return <TaskFileAttachment href={href} name={name} />;
}

function StudentPreviewAttachments({ attachments, pendingFiles }) {
  const items = [];
  for (const att of attachments || []) {
    if (!att?.url) continue;
    items.push({
      key: att.legacy ? "legacy" : String(att.id),
      href: att.url,
      name: att.name || "",
    });
  }
  for (const item of pendingFiles || []) {
    if (!item?.file) continue;
    items.push({
      key: item.id,
      file: item.file,
      name: item.file.name || "",
    });
  }
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => (
        item.file ? (
          <PreviewBlobAttachment key={item.key} file={item.file} name={item.name} />
        ) : (
          <TaskFileAttachment key={item.key} href={item.href} name={item.name} />
        )
      ))}
    </>
  );
}

function IconCondition() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconAnswer() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconParams() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M7 4v6M17 4v6M6 13h4M14 13h4M6 17h4M14 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconPreview() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MyTaskEditorPage() {
  const { taskId } = useParams();
  const isNew = !taskId;
  const navigate = useNavigate();
  const examPartManual = useRef(!isNew);
  const formRef = useRef(null);
  const persistRef = useRef(null);
  const [allowed, setAllowed] = useState(null);
  const [catalog, setCatalog] = useState({ subjects: [], levels: [], task_numbers: [], subtopics: [], tags: [] });
  const [form, setForm] = useState({
    subject: "",
    level: "",
    task_list_id: "",
    subtopic_id: "",
    exam_part: "",
    author: "",
    task_template: "",
    answer: "",
    max_score: 1,
    status: "draft",
    vpr_class: "",
    vpr_advanced: false,
    vpr_basic: false,
    difficulty: "novice",
    extra_tag_ids: [],
    in_ege: false,
  });
  const [attachments, setAttachments] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const pendingFilesRef = useRef([]);
  pendingFilesRef.current = pendingFiles;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(isNew);
  const [bankMeta, setBankMeta] = useState(null);
  const { modal: accessModal, openFromError, openGate } = useAccessGate({
    authenticated: allowed === true,
    currentPlan: bankMeta?.plan_slug || "",
    sourcePage: "/tasks/my/new",
  });
  const createBlocked = isNew && bankMeta?.capabilities?.create_task === false;

  useEffect(() => {
    if (allowed !== true) return undefined;
    let cancelled = false;
    fetchMyTasksMeta()
      .then((meta) => {
        if (!cancelled) setBankMeta(meta);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  useEffect(() => {
    if (!createBlocked) return;
    openGate({
      reason: "limit_reached",
      resourceType: "teacher_tasks",
      requiredPlan: "teacher",
      currentPlan: bankMeta?.plan_slug || "",
      limit: bankMeta?.usage?.task_limit,
      current: bankMeta?.usage?.tasks,
      sourcePage: "editor",
    });
  }, [createBlocked, openGate, bankMeta]);

  useEffect(() => {
    if (allowed !== false) return;
    openGate({
      reason: "anonymous",
      resourceType: "teacher_tasks",
      requiredPlan: "start",
      sourcePage: "editor",
      returnUrl: "/tasks/my",
    });
  }, [allowed, openGate]);

  useEffect(() => {
    fetchCabinetSession()
      .then((session) => {
        const ok = !!session?.authenticated && session?.user?.role === "teacher";
        setAllowed(ok);
        if (ok && isNew) {
          const name = displayNameFromSession(session);
          if (name) {
            setForm((prev) => (prev.author ? prev : { ...prev, author: name }));
          }
        }
      })
      .catch(() => setAllowed(false));
  }, [isNew]);

  useEffect(() => {
    if (!taskId) return undefined;
    fetchMyTask(taskId)
      .then((task) => {
        examPartManual.current = true;
        const level = (task.level || "").trim().toLowerCase();
        setForm({
          subject: (task.subject || "").trim().toLowerCase(),
          level,
          task_list_id: task.task_list_id ? String(task.task_list_id) : "",
          subtopic_id: task.subtopic_id ? String(task.subtopic_id) : "",
          exam_part: task.exam_part ? String(task.exam_part) : "",
          author: task.author || "",
          task_template: task.text_raw || "",
          answer: task.answer || "",
          max_score: task.max_score || 1,
          status: task.status || "draft",
          vpr_class: task.vpr_class || "",
          vpr_advanced: !!task.vpr_advanced,
          vpr_basic: !!task.vpr_basic,
          difficulty: difficultyFromTags(task.tags),
          extra_tag_ids: extraTagIds(task.tags),
          in_ege: level === "ege",
        });
        setAttachments(task.attachments || []);
        setLoaded(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Не удалось открыть задачу");
        setLoaded(true);
      });
  }, [taskId]);

  useEffect(() => {
    if (allowed !== true) return undefined;
    let cancelled = false;
    Promise.all([
      fetchMyTasksCatalog(),
      fetchExamCatalog().catch(() => []),
    ])
      .then(([data, exam]) => {
        if (cancelled) return;
        const fromExam = [];
        for (const level of exam || []) {
          for (const item of level.subjects || []) {
            fromExam.push({ id: item.id, name: item.title });
          }
        }
        setCatalog((prev) => ({
          ...prev,
          subjects: mergeCatalogSubjects(fromExam, data?.subjects, prev.subjects),
          levels: (data?.levels || []).length ? data.levels : prev.levels,
          tags: (data?.tags || []).length ? data.tags : prev.tags,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  useEffect(() => {
    if (allowed !== true) return undefined;
    let cancelled = false;
    fetchMyTasksCatalog({
      subject: form.subject,
      level: form.level,
      task_list_id: form.task_list_id,
    })
      .then((data) => {
        if (cancelled) return;
        setCatalog((prev) => ({
          ...prev,
          subjects: mergeCatalogSubjects(prev.subjects, data.subjects),
          levels: (data.levels || []).length ? data.levels : prev.levels,
          task_numbers: data.task_numbers || [],
          subtopics: data.subtopics || [],
          tags: (data.tags || []).length ? data.tags : prev.tags,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allowed, form.subject, form.level, form.task_list_id]);

  useEffect(() => {
    if (examPartManual.current || !form.task_list_id) return;
    const item = (catalog.task_numbers || []).find((row) => String(row.task_list_id) === String(form.task_list_id));
    const suggested = item?.suggested_exam_part ? String(item.suggested_exam_part) : "";
    setForm((prev) => (prev.exam_part === suggested ? prev : { ...prev, exam_part: suggested }));
  }, [catalog.task_numbers, form.task_list_id]);

  const setField = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "subject" || key === "level") {
        next.task_list_id = "";
        next.subtopic_id = "";
        next.exam_part = "";
        examPartManual.current = false;
      }
      if (key === "level") {
        next.in_ege = String(value) === "ege";
        if (!isExamLevel(value)) next.exam_part = "";
      }
      if (key === "task_list_id") {
        next.subtopic_id = "";
        if (!examPartManual.current) {
          const item = (catalog.task_numbers || []).find((row) => String(row.task_list_id) === String(value));
          next.exam_part = item?.suggested_exam_part ? String(item.suggested_exam_part) : "";
        }
      }
      if (key === "exam_part") examPartManual.current = true;
      return next;
    });
  };

  const persist = async (statusOverride, formEl) => {
    const formNode = formEl || formRef.current;
    if (formNode && typeof formNode.reportValidity === "function" && !formNode.reportValidity()) {
      return;
    }
    if (isNew && bankMeta?.capabilities?.create_task === false) {
      openGate({
        reason: "limit_reached",
        resourceType: "teacher_tasks",
        requiredPlan: "teacher",
        currentPlan: bankMeta?.plan_slug || "",
        limit: bankMeta?.usage?.task_limit,
        current: bankMeta?.usage?.tasks,
        sourcePage: "create",
      });
      return;
    }
    if (!String(form.task_template || "").replace(/<[^>]*>/g, "").trim()) {
      setError("Введите текст задания.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const status = statusOverride || form.status;
      const difficultyId = tagIdForDifficulty(catalog.tags, form.difficulty);
      const tagIds = [...(form.extra_tag_ids || [])];
      if (difficultyId) tagIds.push(difficultyId);
      const payload = {
        task_list_id: Number(form.task_list_id),
        subtopic_id: form.subtopic_id ? Number(form.subtopic_id) : null,
        exam_part: isExamLevel(form.level) && form.exam_part ? Number(form.exam_part) : null,
        author: form.author,
        task_template: sanitizeTaskHtml(form.task_template),
        answer: form.answer,
        max_score: Number(form.max_score) || 1,
        status,
        vpr_class: form.vpr_class ? Number(form.vpr_class) : null,
        vpr_advanced: form.vpr_advanced,
        vpr_basic: form.vpr_basic,
        tag_ids: tagIds,
      };
      if (statusOverride) setField("status", statusOverride);
      const saved = isNew ? await createMyTask(payload) : await updateMyTask(taskId, payload);
      const savedId = saved.id;
      for (const item of pendingFilesRef.current) {
        await uploadMyTaskAttachment(savedId, item.file);
      }
      navigate(`/tasks/my/${savedId}`);
    } catch (err) {
      if (openFromError(err, { sourcePage: isNew ? "create" : "edit" })) return;
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  persistRef.current = persist;

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      persistRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    await persist("ready", event.currentTarget);
  };

  const onUploadImage = async (file) => {
    try {
      const data = await uploadMyTaskImage(file);
      if (!data?.url) throw new Error("Не удалось загрузить изображение");
      return data.url;
    } catch (err) {
      openFromError(err, { resourceType: "storage", sourcePage: "image" });
      throw err;
    }
  };

  const openAttachmentPaywall = () => {
    openGate({
      reason: "feature_not_in_plan",
      resourceType: "teacher_task_attachments",
      requiredPlan: "teacher",
      currentPlan: bankMeta?.plan_slug || "",
      sourcePage: "file",
    });
  };

  const onAttachIntent = () => {
    if (bankMeta?.capabilities?.attach_files === false) {
      openAttachmentPaywall();
      return false;
    }
    return true;
  };

  const onAttachFile = async (file) => {
    setError("");
    if (bankMeta?.capabilities?.attach_files === false) {
      openAttachmentPaywall();
      return;
    }
    try {
      if (!taskId) {
        const next = { id: `${Date.now()}-${file.name}`, file };
        setPendingFiles((prev) => {
          const list = [...prev, next];
          pendingFilesRef.current = list;
          return list;
        });
        return;
      }
      const att = await uploadMyTaskAttachment(taskId, file);
      setAttachments((prev) => [...prev, att]);
    } catch (err) {
      if (openFromError(err, { sourcePage: "file" })) return;
      setError(err instanceof Error ? err.message : "Не удалось прикрепить файл");
      throw err;
    }
  };

  const onRemoveAttachment = async (item) => {
    if (item.pending) {
      setPendingFiles((prev) => prev.filter((row) => row.id !== item.key));
      return;
    }
    if (!taskId) return;
    try {
      await deleteMyTaskAttachment(taskId, item.id ?? null);
      setAttachments((prev) => prev.filter((row) => (row.legacy ? "legacy" : String(row.id)) !== item.key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить файл");
    }
  };

  const attachmentCards = [
    ...attachments.map((item) => ({
      key: item.legacy ? "legacy" : String(item.id),
      id: item.id,
      name: item.name,
      size: item.size,
      url: item.url,
      legacy: !!item.legacy,
    })),
    ...pendingFiles.map((item) => ({
      key: item.id,
      pending: true,
      name: item.file.name,
      size: item.file.size,
    })),
  ];

  const previewHtml = useMemo(() => previewMarkup(form.task_template), [form.task_template]);
  const answerPreviewHtml = useMemo(() => previewMarkup(form.answer), [form.answer]);
  const canPickNumber = Boolean(form.subject && form.level);
  const canPickTopic = Boolean(form.task_list_id);
  const pillClass = form.status === "ready" ? "saas-status is-ready" : "saas-status";

  if (allowed == null) {
    return <MyTaskBankShell>Загрузка…</MyTaskBankShell>;
  }

  if (allowed === false) {
    return (
      <MyTaskBankShell>
        {accessModal}
        <div className="mtb-empty">
          <h2>Мой банк задач</h2>
          <p>Создавайте свои задания и копируйте из общего банка. Зарегистрируйтесь, чтобы сохранить банк и выбрать тариф.</p>
          <Link className="mtb-empty__link" to="/tasks/my">К моему банку</Link>
        </div>
      </MyTaskBankShell>
    );
  }

  if (!loaded || (isNew && allowed === true && bankMeta === null)) {
    return <MyTaskBankShell>Загрузка…</MyTaskBankShell>;
  }

  if (createBlocked) {
    return (
      <MyTaskBankShell className="mtb-page--editor mtb-saas">
        {accessModal}
        <p>Ваши существующие материалы сохранены, но создание новых задач временно недоступно.</p>
        <Link className="mtb-btn mtb-btn--primary" to="/tasks/my">К моему банку</Link>
      </MyTaskBankShell>
    );
  }

  return (
    <MyTaskBankShell className="mtb-page--editor mtb-saas">
      {accessModal}
      <form ref={formRef} className="mtb-editor-form" onSubmit={submit}>
        <header className="saas-topbar">
          <div className="saas-brandline">
            <Link className="saas-back" to="/tasks/my" aria-label="Назад">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <div>
              <div className="saas-eyebrow">
                {isNew ? "Мой банк задач / Новая задача" : "Мой банк задач / Редактирование"}
              </div>
              <h1 className="saas-page-title">
                {isNew ? "Создание задачи" : "Редактирование задачи"}
                <span className={pillClass}>{statusLabel(form.status)}</span>
              </h1>
            </div>
          </div>
          <div className="saas-actions">
            <Link className="saas-btn ghost" to="/tasks/my">Отмена</Link>
            <button
              type="button"
              className="saas-btn"
              disabled={saving}
              onClick={() => persist("draft", formRef.current)}
            >
              Сохранить как черновик
            </button>
            <button type="submit" className="saas-btn primary" disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </header>

        {error ? <p className="saas-error">{error}</p> : null}

        <div className="saas-workspace">
          <section className="saas-stack">
            <article className="saas-card saas-section">
              <div className="saas-section-head">
                <h2 className="saas-section-title">
                  <span className="saas-iconbox"><IconCondition /></span>
                  Условие задачи
                </h2>
                <p className="saas-section-sub">
                  Введите текст задания. Формулы можно писать в LaTeX — результат сразу появится справа.
                </p>
              </div>
              <TeacherTaskRichEditor
                value={form.task_template}
                onChange={(html) => setField("task_template", html)}
                placeholder="Формулы: $x^2$ или $a^2+b^2=c^2$"
                onUploadImage={onUploadImage}
                onAttachFile={onAttachFile}
                onAttachIntent={onAttachIntent}
              />
              <AttachmentList items={attachmentCards} onRemove={onRemoveAttachment} />
            </article>

            <article className="saas-card saas-section">
              <div className="saas-section-head">
                <h2 className="saas-section-title">
                  <span className="saas-iconbox"><IconAnswer /></span>
                  Правильный ответ
                </h2>
                <p className="saas-section-sub">Можно использовать текст, число или формулу.</p>
              </div>
              <TeacherTaskAnswerEditor
                value={form.answer}
                onChange={(value) => setField("answer", value)}
                placeholder="1"
              />
            </article>

            <article className="saas-card saas-section">
              <div className="saas-section-head">
                <h2 className="saas-section-title">
                  <span className="saas-iconbox"><IconParams /></span>
                  Параметры
                </h2>
                <p className="saas-section-sub">Классифицируйте задачу — так её будет проще найти в вашем банке.</p>
              </div>

              <div className="saas-grid">
                <label>
                  <span className="saas-field-label">Предмет</span>
                  <select required value={form.subject} onChange={(e) => setField("subject", e.target.value)}>
                    <option value="">Выберите</option>
                    {(catalog.subjects || []).map((item) => (
                      <option key={`${item.id}-${item.pk || item.name}`} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="saas-field-label">Уровень / класс</span>
                  <select required value={form.level} onChange={(e) => setField("level", e.target.value)}>
                    <option value="">Выберите</option>
                    {(catalog.levels || []).map((item) => (
                      <option key={item.id} value={item.id}>{item.title}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="saas-field-label">Номер задания</span>
                  <select
                    required
                    value={form.task_list_id}
                    disabled={!canPickNumber}
                    onChange={(e) => setField("task_list_id", e.target.value)}
                  >
                    <option value="">
                      {!canPickNumber
                        ? "Сначала предмет и уровень"
                        : (catalog.task_numbers || []).length
                          ? "Выберите"
                          : "Нет номеров для этой пары"}
                    </option>
                    {(catalog.task_numbers || []).map((item) => (
                      <option key={item.task_list_id} value={String(item.task_list_id)}>
                        №{item.task_number} — {item.task_title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="saas-field-label">Тема / подтема</span>
                  <select
                    value={form.subtopic_id}
                    disabled={!canPickTopic}
                    onChange={(e) => setField("subtopic_id", e.target.value)}
                  >
                    <option value="">
                      {!canPickTopic ? "Сначала выберите номер" : "Без темы"}
                    </option>
                    {(catalog.subtopics || []).map((item) => (
                      <option key={item.id} value={String(item.id)}>{item.title}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="saas-divider" />

              <span className="saas-field-label">Уровень сложности</span>
              <div className="saas-chips">
                {DIFFICULTY_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`saas-chip${form.difficulty === chip.id ? " is-active" : ""}`}
                    onClick={() => setField("difficulty", chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div className="saas-divider" />

              <div className="saas-meta-row">
                <button
                  type="button"
                  className="saas-switch-line"
                  onClick={() => setField("in_ege", !form.in_ege)}
                >
                  <span className={`saas-switch${form.in_ege ? " is-on" : ""}`} />
                  Есть в ЕГЭ
                </button>
                <div className="saas-meta-fields">
                  <label>
                    <span className="saas-field-label">Макс. балл</span>
                    <input
                      className="saas-field"
                      type="number"
                      min="1"
                      value={form.max_score}
                      onChange={(e) => setField("max_score", e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="saas-field-label">Статус</span>
                    <select value={form.status} onChange={(e) => setField("status", e.target.value)}>
                      <option value="ready">Готово</option>
                      <option value="draft">Черновик</option>
                      <option value="archived">Архив</option>
                    </select>
                  </label>
                </div>
              </div>
            </article>
          </section>

          <aside className="saas-right">
            <div className="saas-card saas-preview-card">
              <div className="saas-preview-head">
                <div className="saas-preview-title">
                  <IconPreview />
                  Предпросмотр
                </div>
                <span className="saas-live">Обновляется</span>
              </div>
              <div className="saas-preview-body">
                <div className="saas-preview-label">Как увидит ученик</div>
                <div className="saas-render-box">
                  {previewHtml ? (
                    <TeacherTaskPreviewMath>
                      <MathContent html={previewHtml} className="all-tasks-item__html" plainHtml />
                    </TeacherTaskPreviewMath>
                  ) : null}
                  <StudentPreviewAttachments attachments={attachments} pendingFiles={pendingFiles} />
                  {!previewHtml && !attachments.length && !pendingFiles.length ? (
                    <p className="saas-muted">Начните вводить условие — здесь появится предпросмотр.</p>
                  ) : null}
                </div>
                <div className="saas-preview-label">Правильный ответ</div>
                <div className="saas-render-box">
                  {answerPreviewHtml ? (
                    <TeacherTaskPreviewMath>
                      <MathContent html={answerPreviewHtml} className="all-tasks-item__html" plainHtml />
                    </TeacherTaskPreviewMath>
                  ) : (
                    <p className="saas-muted">Ответ появится здесь после ввода.</p>
                  )}
                </div>
              </div>
              <div className="saas-preview-footer">
                <span>Предпросмотр ученика</span>
                <span>Автообновление</span>
              </div>
            </div>

            <div className="saas-card saas-mini-card">
              <span className="saas-iconbox"><IconShield /></span>
              <div>
                <strong>Изменения сохраняются безопасно</strong>
                <span>Черновик можно продолжить позже</span>
              </div>
              <span className="saas-kbd">⌘ S</span>
            </div>
          </aside>
        </div>

        <div className="saas-bottom-bar">
          <button
            type="button"
            className="saas-btn"
            disabled={saving}
            onClick={() => persist("draft", formRef.current)}
          >
            Черновик
          </button>
          <button type="submit" className="saas-btn primary" disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </MyTaskBankShell>
  );
}
