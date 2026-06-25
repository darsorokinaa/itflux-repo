import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import { fetchCabinetSession } from "../../utils/cabinetAuth";
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
  deleteInteractive,
  duplicateInteractive,
  getActiveBackgroundSlug,
  getInteractiveById,
  getInteractiveDisplayTitle,
  upsertInteractive,
} from "../interactivesData";
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

  const [interactive, setInteractive] = useState(() => getInteractiveById(id));
  const [started, setStarted] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
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
    setInteractive(getInteractiveById(id));
    setStarted(false);
  }, [id]);

  const appearance = useMemo(
    () => (interactive ? resolveInteractiveAppearance(interactive, catalog) : null),
    [interactive, catalog],
  );

  const summaryChips = useMemo(
    () => (interactive ? getInteractiveSummaryChips(interactive) : []),
    [interactive],
  );

  const persist = useCallback((next) => {
    upsertInteractive(next);
    setInteractive(next);
  }, []);

  if (!interactive) {
    return <Navigate to="/cabinet/interactives" replace />;
  }

  const activeBackgroundSlug = getActiveBackgroundSlug(interactive);
  const canStart = interactiveHasPlayableContent(interactive);
  const editHref = `/cabinet/interactives/${interactive.id}/edit`;

  const handleBackgroundSelect = (backgroundSlug) => {
    persist(applyBackgroundSlug({ ...interactive, updatedAt: new Date().toISOString() }, backgroundSlug));
  };

  const handleImageUpload = async (file) => {
    try {
      const dataUrl = await compressBackgroundImage(file);
      persist({
        ...interactive,
        backgroundImage: dataUrl,
        backgroundImageTone: interactive.backgroundImageTone || "light",
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setShareMsg(err?.message || "Не удалось загрузить изображение");
      window.setTimeout(() => setShareMsg(""), 2800);
    }
  };

  const handleImageRemove = () => {
    persist({
      ...interactive,
      backgroundImage: null,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleImageToneChange = (tone) => {
    persist({
      ...interactive,
      backgroundImageTone: tone,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleParams = (params) => {
    persist({ ...interactive, params, updatedAt: new Date().toISOString() });
  };

  const handlePublish = () => {
    persist({
      ...interactive,
      status: "published",
      updatedAt: new Date().toISOString(),
    });
    setShareMsg("Интерактив опубликован");
    window.setTimeout(() => setShareMsg(""), 2200);
  };

  const handleUnpublish = () => {
    persist({
      ...interactive,
      status: "draft",
      updatedAt: new Date().toISOString(),
    });
    setShareMsg("Публикация снята");
    window.setTimeout(() => setShareMsg(""), 2200);
  };

  const handleAssign = (payload) => {
    if (!canAssignInteractive(interactive)) {
      setShareMsg("Сначала опубликуйте интерактив");
      window.setTimeout(() => setShareMsg(""), 2800);
      return;
    }
    const target = payload.targetType === "student"
      ? `Ученик: ${payload.targetId}`
      : `Группа: ${payload.targetId}`;
    persist({
      ...interactive,
      status: "assigned",
      usedIn: [...(interactive.usedIn || []), target],
      updatedAt: new Date().toISOString(),
    });
    setAssignOpen(false);
  };

  const handleDuplicate = () => {
    const copy = duplicateInteractive(interactive.id);
    if (copy) navigate(`/cabinet/interactives/${copy.id}`);
  };

  const handleDelete = () => {
    if (!window.confirm(`Удалить «${getInteractiveDisplayTitle(interactive, "интерактив")}»?`)) return;
    deleteInteractive(interactive.id);
    navigate("/cabinet/interactives");
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

      <p className="cb-editor-breadcrumb ix-launch-breadcrumb">
        <Link to="/cabinet/interactives">Интерактивы</Link>
        <span> / </span>
        <span>{getInteractiveDisplayTitle(interactive)}</span>
      </p>

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
    </CabinetPageShell>
  );
}
