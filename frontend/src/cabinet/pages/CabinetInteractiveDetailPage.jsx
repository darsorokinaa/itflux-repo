import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import {
  assignInteractive,
  createInteractive,
  deleteInteractiveApi,
  fetchCabinetSession,
  fetchInteractive,
  publishInteractive,
  updateInteractive,
} from "../../utils/cabinetAuth";
import ConfirmActionModal from "../components/ConfirmActionModal";
import InteractiveAssignModal from "../components/InteractiveAssignModal";
import InteractiveLaunchScreen, { TemplateSwitcher } from "../components/InteractiveLaunchScreen";
import {
  InteractivePassport,
  LaunchInfoBar,
  LaunchResultsSection,
  ParametersPanel,
  VisualStylePicker,
} from "../components/InteractiveLaunchPanels";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import {
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
  compressBackgroundImage,
} from "../interactiveAppearance";
import {
  applyBackgroundSlug,
  canAssignInteractive,
  canShareInteractive,
  getActiveBackgroundSlug,
  getInteractiveDisplayTitle,
} from "../interactivesData";
import {
  buildInteractiveWritePayload,
  mapApiInteractiveDetail,
  mergeInteractiveAfterSave,
} from "../interactivesApi";
import {
  getInteractiveSummaryChips,
  interactiveHasPlayableContent,
} from "../interactivesEditorUtils";
import "../styles/interactives-catalog.css";
import "../styles/interactive-appearance.css";
import "../styles/interactive-launch.css";

function useMobileLaunch() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export default function CabinetInteractiveDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useMobileLaunch();
  const { toast, notifySoon } = useSoonToast();
  const { catalog, loading: catalogLoading } = useInteractiveAppearanceCatalog();

  const [interactive, setInteractive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [authorName, setAuthorName] = useState("Учитель");
  const [shareMsg, setShareMsg] = useState("");

  useEffect(() => {
    fetchCabinetSession()
      .then((data) => {
        if (data?.user) setAuthorName(displayName(data.user));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInteractive(id)
      .then((data) => {
        if (!cancelled) {
          setInteractive(mapApiInteractiveDetail(data));
          setStarted(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (import.meta.env.DEV) console.error("Interactive detail load failed:", err);
          setInteractive(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const appearance = useMemo(
    () => (interactive ? resolveInteractiveAppearance(interactive, catalog) : null),
    [interactive, catalog],
  );

  const summaryChips = useMemo(
    () => (interactive ? getInteractiveSummaryChips(interactive) : []),
    [interactive],
  );

  const persistToApi = useCallback(async (next, statusOverride) => {
    const payload = buildInteractiveWritePayload(next, statusOverride || next.status);
    const data = await updateInteractive(next.id, payload);
    const mapped = mergeInteractiveAfterSave(next, data);
    setInteractive(mapped);
    return mapped;
  }, []);

  const persistLocal = useCallback((next) => {
    setInteractive(next);
  }, []);

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--interactive-detail ix-page ix-launch-page">
        <p className="cb-loading">Загрузка…</p>
      </CabinetPageShell>
    );
  }

  if (!interactive) {
    return <Navigate to="/cabinet/interactives" replace />;
  }

  const activeBackgroundSlug = getActiveBackgroundSlug(interactive);
  const canStart = interactiveHasPlayableContent(interactive);
  const editHref = `/cabinet/interactives/${interactive.id}/edit`;

  const handleBackgroundSelect = async (backgroundSlug) => {
    const next = applyBackgroundSlug({ ...interactive }, backgroundSlug);
    try {
      await persistToApi(next);
    } catch (err) {
      setShareMsg(err?.message || "Не удалось сохранить фон");
      window.setTimeout(() => setShareMsg(""), 2800);
    }
  };

  const handleImageUpload = async (file) => {
    try {
      const dataUrl = await compressBackgroundImage(file);
      persistLocal({
        ...interactive,
        backgroundImage: dataUrl,
        backgroundImageTone: interactive.backgroundImageTone || "light",
      });
    } catch (err) {
      setShareMsg(err?.message || "Не удалось загрузить изображение");
      window.setTimeout(() => setShareMsg(""), 2800);
    }
  };

  const handleImageRemove = () => {
    persistLocal({
      ...interactive,
      backgroundImage: null,
    });
  };

  const handleImageToneChange = (tone) => {
    persistLocal({
      ...interactive,
      backgroundImageTone: tone,
    });
  };

  const handleParams = (params) => {
    persistLocal({ ...interactive, params });
  };

  const handlePublish = async () => {
    try {
      await updateInteractive(interactive.id, buildInteractiveWritePayload(interactive, "published"));
      const data = await publishInteractive(interactive.id);
      setInteractive(mapApiInteractiveDetail(data));
      setShareMsg("Интерактив опубликован");
      window.setTimeout(() => setShareMsg(""), 2200);
    } catch (err) {
      setShareMsg(err?.message || "Не удалось опубликовать");
      window.setTimeout(() => setShareMsg(""), 2800);
    }
  };

  const handleUnpublish = async () => {
    try {
      await persistToApi({ ...interactive }, "draft");
      setShareMsg("Публикация снята");
      window.setTimeout(() => setShareMsg(""), 2200);
    } catch (err) {
      setShareMsg(err?.message || "Не удалось снять публикацию");
      window.setTimeout(() => setShareMsg(""), 2800);
    }
  };

  const handleAssign = async (payload) => {
    if (!canAssignInteractive(interactive)) {
      setShareMsg("Сначала опубликуйте интерактив");
      window.setTimeout(() => setShareMsg(""), 2800);
      return;
    }
    try {
      await assignInteractive(interactive.id, {
        student: payload.targetType === "student" ? Number(payload.targetId) : null,
        group: payload.targetType === "group" ? Number(payload.targetId) : null,
        due_at: payload.deadline ? `${payload.deadline}T23:59:59` : null,
        attempts_allowed: payload.attempts === "single" ? 1 : 3,
        show_result_immediately: payload.showResult !== false,
        comment: payload.comment || "",
      });
      setShareMsg("Интерактив выдан");
      window.setTimeout(() => setShareMsg(""), 2800);
      setAssignOpen(false);
    } catch (err) {
      setShareMsg(err?.message || "Не удалось выдать интерактив");
      window.setTimeout(() => setShareMsg(""), 3200);
    }
  };

  const handleDuplicate = async () => {
    try {
      const copy = mapApiInteractiveDetail(await fetchInteractive(interactive.id));
      copy.title = copy.title ? `${copy.title} (копия)` : "Копия";
      copy.status = "draft";
      const created = await createInteractive(buildInteractiveWritePayload(copy, "draft"));
      navigate(`/cabinet/interactives/${created.id}`);
    } catch (err) {
      setShareMsg(err?.message || "Не удалось создать копию");
      window.setTimeout(() => setShareMsg(""), 3200);
    }
  };

  const handleDelete = () => {
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!interactive) return;
    setDeleteLoading(true);
    try {
      await deleteInteractiveApi(interactive.id);
      setDeleteConfirmOpen(false);
      navigate("/cabinet/interactives");
    } catch (err) {
      setShareMsg(err?.message || "Не удалось удалить");
      window.setTimeout(() => setShareMsg(""), 3200);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleShare = async () => {
    if (!canShareInteractive(interactive)) {
      setShareMsg("Сначала опубликуйте интерактив");
      window.setTimeout(() => setShareMsg(""), 2800);
      return;
    }
    const url = `${window.location.origin}/cabinet/interactives/${interactive.id}/play`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg("Ссылка скопирована");
      window.setTimeout(() => setShareMsg(""), 2800);
    } catch {
      setShareMsg("Не удалось скопировать ссылку");
      window.setTimeout(() => setShareMsg(""), 2800);
    }
  };

  const scrollToHero = () => {
    setStarted(true);
    window.requestAnimationFrame(() => {
      document.querySelector(".ix-launch-hero")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <CabinetPageShell className="cb-section--interactive-detail ix-page ix-launch-page">
      {toast}
      {shareMsg ? <div className="cb-soon-toast" role="status">{shareMsg}</div> : null}

      <div className="ix-launch-top ix-launch-top--v2">
        <InteractiveLaunchScreen
          interactive={interactive}
          appearance={appearance}
          started={started}
          onStart={() => setStarted(true)}
          editHref={editHref}
          fullscreenHref={
            canShareInteractive(interactive)
              ? `/cabinet/interactives/${interactive.id}/play`
              : null
          }
        />
        <TemplateSwitcher
          activeType={interactive.type}
          onSelect={() => notifySoon()}
        />
      </div>

      <LaunchInfoBar
        interactive={interactive}
        authorName={authorName}
        summaryChips={summaryChips}
        canStart={canStart}
        onPublish={handlePublish}
        onStart={scrollToHero}
        onEdit={() => navigate(editHref)}
        onAssign={() => {
          if (!canAssignInteractive(interactive)) {
            setShareMsg("Сначала опубликуйте интерактив");
            window.setTimeout(() => setShareMsg(""), 2800);
            return;
          }
          setAssignOpen(true);
        }}
        onShare={handleShare}
        onDuplicate={handleDuplicate}
        onUnpublish={handleUnpublish}
        onDelete={handleDelete}
        onAccessSettings={() => navigate(editHref)}
      />

      <InteractivePassport interactive={interactive} />

      <div className="ix-launch-bottom ix-launch-bottom--v2">
        <VisualStylePicker
          backgrounds={catalog.backgrounds}
          loading={catalogLoading}
          activeBackgroundSlug={activeBackgroundSlug}
          backgroundImage={interactive.backgroundImage}
          backgroundImageTone={interactive.backgroundImageTone}
          onSelectBackground={handleBackgroundSelect}
          onImageUpload={handleImageUpload}
          onImageRemove={handleImageRemove}
          onImageToneChange={handleImageToneChange}
          compact
        />
        <ParametersPanel
          params={interactive.params}
          onChange={handleParams}
          mobileAccordion={isMobile}
        />
      </div>

      <LaunchResultsSection results={interactive.results} />

      {isMobile ? (
        <div className="ix-launch-mobile-bar">
          {interactive.status === "draft" || interactive.status === "review" ? (
            <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={handlePublish}>
              Опубликовать
            </button>
          ) : (
            <button
              type="button"
              className="cb-btn cb-btn--primary cb-btn--pill"
              disabled={!canStart}
              onClick={scrollToHero}
            >
              Начать
            </button>
          )}
          <button type="button" className="cb-btn cb-btn--outline" onClick={() => navigate(editHref)}>
            Редактировать
          </button>
        </div>
      ) : null}

      {assignOpen ? (
        <InteractiveAssignModal
          interactive={interactive}
          onClose={() => setAssignOpen(false)}
          onAssign={handleAssign}
        />
      ) : null}

      <ConfirmActionModal
        open={deleteConfirmOpen}
        title="Удалить интерактив?"
        text={`Удалить «${getInteractiveDisplayTitle(interactive, "интерактив")}»?`}
        confirmLabel="Удалить"
        danger
        loading={deleteLoading}
        onClose={() => {
          if (!deleteLoading) setDeleteConfirmOpen(false);
        }}
        onConfirm={confirmDelete}
      />
    </CabinetPageShell>
  );
}
