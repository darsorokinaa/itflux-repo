import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import { fetchCabinetSession } from "../../utils/cabinetAuth";
import InteractiveAssignModal from "../components/InteractiveAssignModal";
import InteractiveLaunchScreen, { TemplateSwitcher } from "../components/InteractiveLaunchScreen";
import {
  LaunchInfoBar,
  ParametersPanel,
  ResultsPanel,
  VisualStylePicker,
} from "../components/InteractiveLaunchPanels";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import {
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
  compressBackgroundImage,
} from "../interactiveAppearance";
import {
  applyVisualTheme,
  canAssignInteractive,
  canShareInteractive,
  duplicateInteractive,
  getInteractiveById,
  getVisualThemeId,
  upsertInteractive,
} from "../interactivesData";
import "../styles/interactives-catalog.css";
import "../styles/interactive-appearance.css";
import "../styles/interactive-launch.css";

export default function CabinetInteractiveDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, notifySoon } = useSoonToast();
  const { catalog } = useInteractiveAppearanceCatalog();

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

  const appearance = useMemo(
    () => (interactive ? resolveInteractiveAppearance(interactive, catalog) : null),
    [interactive, catalog],
  );

  const persist = useCallback((next) => {
    upsertInteractive(next);
    setInteractive(next);
  }, []);

  if (!interactive) {
    return <Navigate to="/cabinet/interactives" replace />;
  }

  const themeId = getVisualThemeId(interactive);

  const handleTheme = (nextThemeId) => {
    persist(applyVisualTheme({ ...interactive, updatedAt: new Date().toISOString() }, nextThemeId));
  };

  const handleImageUpload = async (file) => {
    try {
      const dataUrl = await compressBackgroundImage(file);
      persist({
        ...interactive,
        backgroundImage: dataUrl,
        visualThemeId: "custom",
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
      visualThemeId: getVisualThemeId({ ...interactive, backgroundImage: null }),
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

  const handleTitleChange = (title) => {
    persist({ ...interactive, title, updatedAt: new Date().toISOString() });
    setShareMsg("Название сохранено");
    window.setTimeout(() => setShareMsg(""), 2200);
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

  return (
    <CabinetPageShell className="cb-section--interactive-detail ix-page ix-launch-page">
      {toast}
      {shareMsg ? <div className="cb-soon-toast" role="status">{shareMsg}</div> : null}

      <p className="cb-editor-breadcrumb ix-launch-breadcrumb">
        <Link to="/cabinet/interactives">Интерактивы</Link>
        <span> / </span>
        <span>{interactive.title || "Без названия"}</span>
      </p>

      <div className="ix-launch-top">
        <InteractiveLaunchScreen
          interactive={interactive}
          appearance={appearance}
          started={started}
          onStart={() => setStarted(true)}
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
        onTitleChange={handleTitleChange}
        onPublish={handlePublish}
        onEdit={() => navigate(`/cabinet/interactives/${interactive.id}/edit`)}
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
        onMore={notifySoon}
      />

      <div className="ix-launch-bottom">
        <VisualStylePicker
          activeId={themeId}
          backgroundImage={interactive.backgroundImage}
          backgroundImageTone={interactive.backgroundImageTone}
          onSelect={handleTheme}
          onImageUpload={handleImageUpload}
          onImageRemove={handleImageRemove}
          onImageToneChange={handleImageToneChange}
        />
        <ParametersPanel params={interactive.params} onChange={handleParams} />
        <ResultsPanel results={interactive.results} />
      </div>

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
