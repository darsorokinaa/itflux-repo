import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useNavigate, useParams } from "react-router-dom";

import Layout from "./pages/Layout";
import HomePage from "./pages/HomePage";
const AllTasksPage = lazy(() => import("./pages/AllTasksPage"));
const MyTaskBankPage = lazy(() => import("./pages/MyTaskBankPage"));
const MyTaskEditorPage = lazy(() => import("./pages/MyTaskEditorPage"));
const MyTaskDetailPage = lazy(() => import("./pages/MyTaskDetailPage"));
const ExamLevelHubPage = lazy(() => import("./pages/ExamLevelHubPage"));
const SubjectPage = lazy(() => import("./pages/SubjectPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const SearchTaskPage = lazy(() => import("./pages/SearchTaskPage"));
const SearchVariantPage = lazy(() => import("./pages/SearchVariantPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const MessagingAgreementPage = lazy(() => import("./pages/MessagingAgreementPage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const LessonJoinBridge = lazy(() => import("./pages/LessonJoinBridge"));
const ReadyLessonsPage = lazy(() => import("./pages/ReadyLessonsPage"));
const LessonCollectionPage = lazy(() => import("./pages/LessonCollectionPage"));
const LessonViewerPage = lazy(() => import("./pages/LessonViewerPage"));
const InterestingPage = lazy(() => import("./pages/InterestingPage"));
const InterestingViewerPage = lazy(() => import("./pages/InterestingViewerPage"));
const ForTeachersPage = lazy(() => import("./pages/ForTeachersPage"));
const TutorLandingPage = lazy(() => import("./pages/TutorLandingPage"));
const TeacherBookingPage = lazy(() => import("./pages/TeacherBookingPage"));
const CabinetAuthPage = lazy(() => import("./pages/CabinetAuthPage"));
const CabinetJoinPage = lazy(() => import("./cabinet/pages/CabinetJoinPage"));
const CabinetNotificationsSettingsPage = lazy(() => import("./cabinet/pages/CabinetNotificationsSettingsPage"));
const CabinetPage = lazy(() => import("./pages/CabinetPage"));
const CabinetDashboard = lazy(() => import("./cabinet/CabinetDashboard"));
const CabinetStudentsPage = lazy(() => import("./cabinet/pages/CabinetStudentsPage"));
const CabinetStudentMaterialsPage = lazy(() => import("./cabinet/pages/CabinetStudentMaterialsPage"));
const CabinetLessonsPage = lazy(() => import("./cabinet/pages/CabinetLessonsPage"));
const CabinetReviewPage = lazy(() => import("./cabinet/pages/CabinetReviewPage"));
const CabinetHomeworkEditPage = lazy(() => import("./cabinet/pages/CabinetHomeworkEditPage"));
const CabinetLibraryPage = lazy(() => import("./cabinet/pages/CabinetLibraryPage"));
const CabinetSchedulePage = lazy(() => import("./cabinet/pages/CabinetSchedulePage"));
const CabinetMessagesPage = lazy(() => import("./cabinet/pages/CabinetMessagesPage"));
const CommunityInvitePage = lazy(() => import("./cabinet/pages/CommunityInvitePage"));
const CabinetLessonPlansPage = lazy(() => import("./cabinet/pages/CabinetLessonPlansPage"));
const CabinetLessonPlanDetailPage = lazy(() => import("./cabinet/pages/CabinetLessonPlanDetailPage"));
const CabinetLessonPlanEditorPage = lazy(() => import("./cabinet/pages/CabinetLessonPlanEditorPage"));
const CabinetInteractivesPage = lazy(() => import("./cabinet/pages/CabinetInteractivesPage"));
const CabinetInteractiveCreatePage = lazy(() => import("./cabinet/pages/CabinetInteractiveCreatePage"));
const CabinetInteractiveEditorPage = lazy(() => import("./cabinet/pages/CabinetInteractiveEditorPage"));
const CabinetInteractiveDetailPage = lazy(() => import("./cabinet/pages/CabinetInteractiveDetailPage"));
const CabinetInteractivePlayPage = lazy(() => import("./cabinet/pages/CabinetInteractivePlayPage"));
const CabinetBoardsPage = lazy(() => import("./cabinet/pages/CabinetBoardsPage"));
const CabinetWorksheetEditorPage = lazy(() => import("./cabinet/pages/CabinetWorksheetEditorPage"));
const WorksheetAIWizard = lazy(() => import("./cabinet/worksheet/WorksheetAIWizard"));
const WorksheetSoonPage = lazy(() => import("./pages/WorksheetSoonPage"));
import { WORKSHEETS_CONSTRUCTOR_ENABLED } from "./cabinet/featureFlags";
const CabinetFilesPage = lazy(() => import("./cabinet/pages/CabinetFilesPage"));
const CabinetMorePage = lazy(() => import("./cabinet/pages/CabinetMorePage"));
const CabinetReportsPage = lazy(() => import("./cabinet/CabinetReportsPage"));
const CabinetUpgradePage = lazy(() => import("./cabinet/pages/CabinetUpgradePage"));
const CabinetVariantThemesPage = lazy(() => import("./cabinet/pages/CabinetVariantThemesPage"));
const CabinetVariantThemeEditorPage = lazy(() => import("./cabinet/pages/CabinetVariantThemeEditorPage"));
const CabinetPaymentsPage = lazy(() => import("./cabinet/pages/CabinetPaymentsPage"));
const CabinetJournalPage = lazy(() => import("./cabinet/pages/CabinetJournalPage"));
const CabinetJournalAnalyticsPage = lazy(() => import("./cabinet/pages/CabinetJournalAnalyticsPage"));
const CabinetLessonSummaryPage = lazy(() => import("./cabinet/pages/CabinetLessonSummaryPage"));
const ParentCabinetPage = lazy(() => import("./cabinet/pages/ParentCabinetPage"));
const ParentDashboardPage = lazy(() => import("./cabinet/pages/ParentDashboardPage"));
const ParentHomeworkPage = lazy(() => import("./cabinet/pages/ParentHomeworkPage"));
const ParentResultsPage = lazy(() => import("./cabinet/pages/ParentResultsPage"));
const ParentSchedulePage = lazy(() => import("./cabinet/pages/ParentSchedulePage"));
const ParentBillingPage = lazy(() => import("./cabinet/pages/ParentBillingPage"));
const ParentMorePage = lazy(() => import("./cabinet/pages/ParentMorePage"));
const ParentInviteAcceptPage = lazy(() => import("./cabinet/pages/ParentInviteAcceptPage"));
const StudentCabinetPage = lazy(() => import("./pages/StudentCabinetPage"));
const StudentDashboard = lazy(() => import("./cabinet/student/pages/StudentDashboard"));
const StudentLessonsPage = lazy(() => import("./cabinet/student/pages/StudentLessonsPage"));
const StudentLessonDetailPage = lazy(() => import("./cabinet/student/pages/StudentLessonDetailPage"));
const StudentAssignmentsPage = lazy(() => import("./cabinet/student/pages/StudentAssignmentsPage"));
const StudentAssignmentDetailPage = lazy(() => import("./cabinet/student/pages/StudentAssignmentDetailPage"));
const StudentInteractivePlayPage = lazy(() => import("./cabinet/student/pages/StudentInteractivePlayPage"));
const StudentMaterialsPage = lazy(() => import("./cabinet/student/pages/StudentMaterialsPage"));
const StudentFilesPage = lazy(() => import("./cabinet/student/pages/StudentFilesPage"));
const StudentBoardsPage = lazy(() => import("./cabinet/student/pages/StudentBoardsPage"));
const StudentProfilePage = lazy(() => import("./cabinet/student/pages/StudentProfilePage"));
const StudentResultsPage = lazy(() => import("./cabinet/student/pages/StudentResultsPage"));
const StudentTopicsPage = lazy(() => import("./cabinet/student/pages/StudentTopicsPage"));
const StudentProgressPage = lazy(() => import("./cabinet/student/pages/StudentProgressPage"));
const StudentMorePage = lazy(() => import("./cabinet/student/pages/StudentMorePage"));
import ErrorBoundary from "./components/ErrorBoundary";
import AppUpdateBanner from "./components/AppUpdateBanner";
import { ensureSiteFavicon } from "./utils/ensureSiteFavicon";
import { markUpdateFromClientRequired } from "./utils/appUpdate";
import { SeasonalThemeProvider } from "./seasonal/SeasonalThemeProvider";

const ExamPage = lazy(() => import("./pages/ExamPage"));
const CabinetReviewDetailPage = lazy(() => import("./cabinet/pages/CabinetReviewDetailPage"));
const BoardEditorGate = lazy(() => import("./cabinet/boards/BoardEditorGate"));
const HomeworkNotebookEditor = lazy(() => import("./cabinet/notebook/HomeworkNotebookEditor"));
const HomeworkPublishedNotebookPage = lazy(() =>
  import("./cabinet/notebook/HomeworkNotebookEditor").then((mod) => ({
    default: mod.HomeworkPublishedNotebookPage,
  })),
);
const VideoMeetingPage = lazy(() => import("./cabinet/pages/VideoMeetingPage"));
const JaasBareProbe = lazy(() => import("./cabinet/pages/JaasBareProbe"));
const MeetingCallDock = lazy(() => import("./cabinet/components/MeetingCallDock"));

function MeetingCallDockGate() {
  const location = useLocation();
  const meeting = new URLSearchParams(location.search).get("meeting");
  if (!meeting) return null;
  return (
    <Suspense fallback={null}>
      <MeetingCallDock />
    </Suspense>
  );
}

const DEFAULT_META_DESCRIPTION =
  "Цифровой поток: подготовка к ОГЭ и ЕГЭ, генератор вариантов, банк задач, интерактивные уроки и личный кабинет учителя.";

function LegacyInviteRedirect() {
  const { token } = useParams();
  return <Navigate to={`/invite/${token}/`} replace />;
}

function getMetaDescriptionForPath(pathname) {
  const path = pathname || "/";

  if (path === "/") {
    return "Цифровой поток — онлайн-платформа для подготовки к ОГЭ и ЕГЭ: генератор вариантов, банк задач и инструменты для учителя.";
  }
  if (path.startsWith("/tasks")) {
    return "Банк заданий ОГЭ, ЕГЭ и ВПР: фильтры по предмету, номеру и подтеме, создание варианта и рабочей тетради.";
  }
  if (path.startsWith("/generator")) {
    return "Генератор экзаменационных вариантов с автоматической сборкой задач по предметам и уровням подготовки.";
  }
  if (path === "/subject" || /^\/subject\/(oge|ege|vpr)\/?$/.test(path)) {
    return "Выберите уровень и предмет для подготовки к экзаменам на платформе «Цифровой поток».";
  }
  if (path === "/lessons" || /^\/lessons\/collections\/[^/]+\/?$/.test(path) || /^\/lessons\/[^/]+\/view\/?$/.test(path)) {
    return "Готовые уроки и материалы: откройте занятие, просмотрите файл и используйте контент в учебном процессе.";
  }
  if (path === "/worksheets" || path.startsWith("/worksheets/")) {
    return "Конструктор материалов: сборка заданий, правки блоков и выгрузка в PDF.";
  }
  if (path === "/interesting" || path.startsWith("/interesting/")) {
    return "Тренажёры и интерактивы: материалы и факты об информатике на платформе «Цифровой поток».";
  }
  if (path === "/teachers" || path === "/for-teachers") {
    return "Решения для учителей: управление классами, планами, домашними заданиями и интерактивными материалами.";
  }
  if (path === "/privacy") {
    return "Политика конфиденциальности платформы «Цифровой поток».";
  }
  if (path === "/messages-agreement") {
    return "Соглашение об использовании сообщений на платформе «Цифровой поток».";
  }
  if (path === "/pricing" || path.startsWith("/pricing/")) {
    return "Тарифы «Цифровой поток»: Старт, Учитель, Профи, Премиум и Школа — кабинет, библиотека и лимиты для преподавателей.";
  }
  if (path.startsWith("/book/")) {
    return "Запись на постоянное время занятий к преподавателю на платформе «Цифровой поток».";
  }
  if (path.startsWith("/cabinet/student")) {
    return "Личный кабинет ученика: уроки, домашние задания, интерактивы и результаты обучения.";
  }
  if (path.startsWith("/cabinet/login") || path.startsWith("/login")) {
    return "Вход в личный кабинет «Цифровой поток».";
  }
  if (path.startsWith("/invite/") || path.startsWith("/cabinet/join/")) {
    return "Присоединение к кабинету по приглашению учителя.";
  }
  if (path.startsWith("/cabinet/settings/notifications")) {
    return "Настройки уведомлений и подключение Telegram.";
  }
  if (path.startsWith("/cabinet")) {
    return "Личный кабинет учителя: ученики, группы, планы уроков, расписание, интерактивы и проверка работ.";
  }
  if (path.startsWith("/search/tasks")) {
    return "Поиск заданий по ID в банке задач «Цифровой поток».";
  }
  if (path.startsWith("/search-variant")) {
    return "Поиск варианта по номеру и быстрый переход к заданиям.";
  }
  if (path.startsWith("/lesson/join")) {
    return "Подключение к онлайн-уроку по ссылке приглашения.";
  }
  if (/^\/(oge|ege|vpr)\/[a-z0-9_-]+\/variant\/\d+\/?$/.test(path)) {
    return "Экзаменационный вариант: решайте задания онлайн, проверяйте ответы и скачивайте PDF.";
  }
  if (/^\/(oge|ege|vpr)\/[a-z0-9_-]+\/?$/.test(path)) {
    return "Подбор и решение задач по выбранному предмету и уровню подготовки.";
  }
  if (/^\/(oge|ege|vpr)\/?$/.test(path)) {
    return "Подготовка к экзаменам по уровням: ОГЭ, ЕГЭ и школьная база.";
  }
  return "Страница не найдена. Перейдите в банк задач или на главную страницу «Цифровой поток».";
}

function scrollDocumentToTop() {
  window.scrollTo(0, 0);
  const se = document.scrollingElement;
  if (se) {
    se.scrollTop = 0;
    se.scrollLeft = 0;
  }
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const shell = document.querySelector(".app-shell-content");
  if (shell && shell.scrollTop > 0) {
    shell.scrollTop = 0;
  }
}

/** Редирект с «битых» путей (например /дщпшт вместо /login — русская раскладка в админке). */
function CyrillicPathRedirect() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (/[\u0400-\u04FF]/.test(location.pathname)) {
      navigate("/", { replace: true });
    }
  }, [location.pathname, navigate]);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    scrollDocumentToTop();
    const id = requestAnimationFrame(() => {
      scrollDocumentToTop();
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  useEffect(() => {
    ensureSiteFavicon();
  }, [pathname]);

  return null;
}

function MetaDescriptionSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const content = getMetaDescriptionForPath(pathname) || DEFAULT_META_DESCRIPTION;
    meta.setAttribute("content", content);
  }, [pathname]);

  return null;
}

function SearchTaskWithKey() {
  const location = useLocation();
  return <SearchTaskPage key={location.search} />;
}

function SearchVariantWithKey() {
  const location = useLocation();
  return <SearchVariantPage key={location.search} />;
}

/** Не открывать экзамен как /:level/:subject при level=lesson, subject=join */
function LessonJoinVariantRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: "/lesson/join/", search: location.search }} replace />;
}

/** Страница варианта под error boundary: сбой рендера не должен давать пустой экран. */
function ExamPageWithBoundary() {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
      <ExamPage />
    </ErrorBoundary>
  );
}

function ClientUpdateRequiredListener() {
  useEffect(() => {
    const onRequired = (event) => {
      markUpdateFromClientRequired(event?.detail?.minimumVersion || "");
    };
    window.addEventListener("itflux:client-update-required", onRequired);
    return () => window.removeEventListener("itflux:client-update-required", onRequired);
  }, []);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <SeasonalThemeProvider>
      <CyrillicPathRedirect />
      <ScrollToTop />
      <MetaDescriptionSync />
      <ClientUpdateRequiredListener />
      <AppUpdateBanner />
      <Suspense fallback={null}>
      <Routes>
        <Route path="/dev/jaas-bare/:meetingUuid" element={<JaasBareProbe />} />

        <Route element={<Layout />}>

          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<Navigate to="/" replace />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/messages-agreement" element={<MessagingAgreementPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/pricing/" element={<PricingPage />} />
          <Route path="/tasks" element={<AllTasksPage />} />
          <Route path="/tasks/my" element={<MyTaskBankPage />} />
          <Route path="/tasks/my/new" element={<MyTaskEditorPage />} />
          <Route path="/tasks/my/:taskId/edit" element={<MyTaskEditorPage />} />
          <Route path="/tasks/my/:taskId" element={<MyTaskDetailPage />} />
          <Route path="/generator" element={<Navigate to="/subject" replace />} />
          <Route path="/gotovye-uroki" element={<ReadyLessonsPage />} />
          <Route path="/gotovye-uroki/" element={<ReadyLessonsPage />} />
          <Route path="/repetitor" element={<TutorLandingPage />} />
          <Route path="/repetitor/" element={<TutorLandingPage />} />
          <Route path="/lessons" element={<ReadyLessonsPage />} />
          <Route path="/lessons/collections/:slug" element={<LessonCollectionPage />} />
          <Route path="/lessons/:slug/view" element={<LessonViewerPage />} />
          <Route path="/worksheets/ai" element={WORKSHEETS_CONSTRUCTOR_ENABLED ? <WorksheetAIWizard /> : <WorksheetSoonPage />} />
          <Route path="/worksheets" element={WORKSHEETS_CONSTRUCTOR_ENABLED ? <CabinetWorksheetEditorPage /> : <WorksheetSoonPage />} />
          <Route path="/interesting" element={<InterestingPage />} />
          <Route path="/interesting/:slug/view" element={<InterestingViewerPage />} />
          <Route path="/teachers" element={<ForTeachersPage />} />
          <Route path="/for-teachers" element={<Navigate to="/teachers" replace />} />
          <Route path="/cabinet/login" element={<CabinetAuthPage />} />
          <Route path="/book/:token" element={<TeacherBookingPage />} />
          <Route path="/book/:token/" element={<TeacherBookingPage />} />
          <Route path="/invite/:token" element={<CabinetJoinPage />} />
          <Route path="/invite/:token/" element={<CabinetJoinPage />} />
          <Route path="/community/invite/:token" element={<CommunityInvitePage />} />
          <Route path="/community/invite/:token/" element={<CommunityInvitePage />} />
          <Route path="/parent/invite/accept/:token" element={<ParentInviteAcceptPage />} />
          <Route path="/parent/invite/accept/:token/" element={<ParentInviteAcceptPage />} />
          <Route path="/cabinet/join/:token" element={<LegacyInviteRedirect />} />
          <Route path="/cabinet/join/:token/" element={<LegacyInviteRedirect />} />
          <Route path="/cabinet/interactives/:id/play" element={<CabinetInteractivePlayPage />} />
          <Route
            path="/cabinet/boards/:boardId"
            element={(
              <ErrorBoundary kind="room" homeHref="/cabinet">
                <BoardEditorGate />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/cabinet/notebook/:notebookId"
            element={(
              <ErrorBoundary kind="room" homeHref="/cabinet">
                <HomeworkNotebookEditor />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/cabinet/notebook/published/:submissionId/:taskId"
            element={(
              <ErrorBoundary kind="room" homeHref="/cabinet">
                <HomeworkPublishedNotebookPage />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/teacher/boards/:boardId"
            element={(
              <ErrorBoundary kind="room" homeHref="/cabinet">
                <BoardEditorGate />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/cabinet/meetings/:meetingUuid"
            element={(
              <ErrorBoundary kind="room" homeHref="/cabinet">
                <VideoMeetingPage />
              </ErrorBoundary>
            )}
          />
          <Route path="/cabinet/student" element={<StudentCabinetPage />}>
            <Route index element={<StudentDashboard />} />
            {/* === Основные вкладки MVP === */}
            <Route path="lessons"          element={<StudentLessonsPage />} />
            <Route path="lessons/:id"      element={<StudentLessonDetailPage />} />
            <Route path="assignments"      element={<StudentAssignmentsPage />} />
            <Route path="assignments/:id"  element={<StudentAssignmentDetailPage />} />
            <Route path="results"          element={<StudentResultsPage />} />
            <Route path="results/:recordId" element={<StudentResultsPage />} />
            <Route path="topics"           element={<StudentTopicsPage />} />
            <Route path="progress"         element={<StudentProgressPage />} />
            <Route path="profile"          element={<StudentProfilePage />} />
            <Route path="materials"        element={<StudentMaterialsPage />} />
            <Route path="files"            element={<StudentFilesPage />} />
            <Route path="boards"           element={<StudentBoardsPage />} />
            {/* === Интерактив плеер (полноэкранный, без шапки) === */}
            <Route path="interactives/:id/play" element={<StudentInteractivePlayPage />} />
            {/* === Редиректы удалённых разделов === */}
            <Route path="interactives" element={<Navigate to="/cabinet/student/assignments" replace />} />
            <Route path="schedule"     element={<Navigate to="/cabinet/student/lessons" replace />} />
            <Route path="more"         element={<StudentMorePage />} />
            <Route path="messages" element={<CabinetMessagesPage />} />
            <Route path="messages/" element={<CabinetMessagesPage />} />
            <Route path="settings/notifications" element={<CabinetNotificationsSettingsPage />} />
            <Route path="settings/notifications/" element={<CabinetNotificationsSettingsPage />} />
          </Route>
          <Route path="/cabinet/parent" element={<ParentCabinetPage />}>
            <Route index element={<ParentDashboardPage />} />
            <Route path="schedule" element={<ParentSchedulePage />} />
            <Route path="homework" element={<ParentHomeworkPage />} />
            <Route path="results" element={<ParentResultsPage />} />
            <Route path="journal" element={<ParentResultsPage />} />
            <Route path="billing" element={<ParentBillingPage />} />
            <Route path="more" element={<ParentMorePage />} />
            <Route path="settings/notifications" element={<CabinetNotificationsSettingsPage />} />
            <Route path="settings/notifications/" element={<CabinetNotificationsSettingsPage />} />
          </Route>
          <Route path="/cabinet" element={<CabinetPage />}>
            <Route index element={<CabinetDashboard />} />
            <Route path="settings/notifications" element={<CabinetNotificationsSettingsPage />} />
            <Route path="settings/notifications/" element={<CabinetNotificationsSettingsPage />} />
            <Route path="messages" element={<CabinetMessagesPage />} />
            <Route path="messages/" element={<CabinetMessagesPage />} />
            <Route path="students" element={<CabinetStudentsPage />} />
            <Route path="students/:studentId/materials" element={<CabinetStudentMaterialsPage />} />
            <Route path="lessons" element={<CabinetLessonsPage />} />
            <Route path="plans" element={<CabinetLessonPlansPage />} />
            <Route path="plans/new" element={<CabinetLessonPlanEditorPage />} />
            <Route path="plans/:planId" element={<CabinetLessonPlanDetailPage />} />
            <Route path="plans/:planId/edit" element={<CabinetLessonPlanEditorPage />} />
            <Route
              path="interactives"
              element={(
                <ErrorBoundary>
                  <CabinetInteractivesPage />
                </ErrorBoundary>
              )}
            />
            <Route
              path="interactives/new"
              element={(
                <ErrorBoundary>
                  <CabinetInteractiveCreatePage />
                </ErrorBoundary>
              )}
            />
            <Route
              path="interactives/new/:type"
              element={(
                <ErrorBoundary>
                  <CabinetInteractiveEditorPage />
                </ErrorBoundary>
              )}
            />
            <Route
              path="interactives/:id/edit"
              element={(
                <ErrorBoundary>
                  <CabinetInteractiveEditorPage />
                </ErrorBoundary>
              )}
            />
            <Route
              path="interactives/:id"
              element={(
                <ErrorBoundary>
                  <CabinetInteractiveDetailPage />
                </ErrorBoundary>
              )}
            />
            <Route path="boards" element={<CabinetBoardsPage />} />
            <Route path="worksheets/ai" element={WORKSHEETS_CONSTRUCTOR_ENABLED ? <WorksheetAIWizard /> : <WorksheetSoonPage />} />
            <Route path="worksheets" element={WORKSHEETS_CONSTRUCTOR_ENABLED ? <CabinetWorksheetEditorPage /> : <WorksheetSoonPage />} />
            <Route path="files" element={<CabinetFilesPage />} />
            <Route
              path="review/:reviewId"
              element={(
                <ErrorBoundary>
                  <CabinetReviewDetailPage />
                </ErrorBoundary>
              )}
            />
            <Route path="review" element={<CabinetReviewPage />} />
            <Route path="homework/:homeworkId/edit" element={<CabinetHomeworkEditPage />} />
            <Route path="journal" element={<CabinetJournalPage />} />
            <Route path="journal/analytics" element={<CabinetJournalAnalyticsPage />} />
            <Route path="journal/lesson/:eventId" element={<CabinetLessonSummaryPage />} />
            <Route path="reports" element={<CabinetReportsPage />} />
            <Route path="library" element={<CabinetLibraryPage />} />
            <Route path="schedule" element={<CabinetSchedulePage />} />
            <Route path="payments" element={<CabinetPaymentsPage />} />
            <Route path="ai" element={<Navigate to="/cabinet" replace />} />
            <Route path="more" element={<CabinetMorePage />} />
            <Route path="upgrade" element={<CabinetUpgradePage />} />
            <Route path="variant-themes" element={<CabinetVariantThemesPage />} />
            <Route path="variant-themes/:themeId" element={<CabinetVariantThemeEditorPage />} />
          </Route>
          <Route path="/login" element={<Navigate to="/cabinet/login" replace />} />
          <Route path="/subject" element={<SubjectPage />} />
          <Route path="/subject/:level" element={<SubjectPage />} />

          <Route path="/search/tasks" element={<SearchTaskWithKey />} />
          <Route path="/search-variant" element={<SearchVariantWithKey />} />

          {/* Иначе /lesson/join матчится как /:level/:subject → «join» и ложная «Ошибка загрузки» */}
          <Route path="/lesson/join" element={<LessonJoinBridge />} />
          <Route path="/lesson/join/" element={<LessonJoinBridge />} />
          <Route path="/lesson/join/variant/:variant_id" element={<LessonJoinVariantRedirect />} />

          <Route path="/vpr" element={<Navigate to="/subject/vpr" replace />} />

          <Route path="/:level" element={<ExamLevelHubPage />} />

          <Route path="/:level/:subject" element={<TasksPage />} />

          <Route
            path="/:level/:subject/variant/:variant_id"
            element={<ExamPageWithBoundary />}
          />

          <Route path="*" element={<NotFoundPage />} />

        </Route>

      </Routes>
      </Suspense>
      <MeetingCallDockGate />
      </SeasonalThemeProvider>
    </BrowserRouter>
  );
}

export default App;
