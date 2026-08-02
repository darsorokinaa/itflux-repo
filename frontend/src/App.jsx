import { useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useNavigate, useParams } from "react-router-dom";

import Layout from "./pages/Layout";
import HomePage from "./pages/HomePage";
import AllTasksPage from "./pages/AllTasksPage";
import ExamLevelHubPage from "./pages/ExamLevelHubPage";
import SubjectPage from "./pages/SubjectPage";
import TasksPage from "./pages/TasksPage";
import ExamPage from "./pages/ExamPage";
import SearchTaskPage from "./pages/SearchTaskPage";
import SearchVariantPage from "./pages/SearchVariantPage";
import PrivacyPage from "./pages/PrivacyPage";
import NotFoundPage from "./pages/NotFoundPage";
import LessonJoinBridge from "./pages/LessonJoinBridge";
import ReadyLessonsPage from "./pages/ReadyLessonsPage";
import LessonViewerPage from "./pages/LessonViewerPage";
import InterestingPage from "./pages/InterestingPage";
import ForTeachersPage from "./pages/ForTeachersPage";
import CabinetAuthPage from "./pages/CabinetAuthPage";
import CabinetJoinPage from "./cabinet/pages/CabinetJoinPage";
import CabinetNotificationsSettingsPage from "./cabinet/pages/CabinetNotificationsSettingsPage";
import CabinetPage from "./pages/CabinetPage";
import CabinetDashboard from "./cabinet/CabinetDashboard";
import CabinetStudentsPage from "./cabinet/pages/CabinetStudentsPage";
import CabinetLessonsPage from "./cabinet/pages/CabinetLessonsPage";
import CabinetReviewPage from "./cabinet/pages/CabinetReviewPage";
import CabinetReviewDetailPage from "./cabinet/pages/CabinetReviewDetailPage";
import CabinetHomeworkEditPage from "./cabinet/pages/CabinetHomeworkEditPage";
import CabinetLibraryPage from "./cabinet/pages/CabinetLibraryPage";
import CabinetSchedulePage from "./cabinet/pages/CabinetSchedulePage";
import CabinetLessonPlansPage from "./cabinet/pages/CabinetLessonPlansPage";
import CabinetLessonPlanDetailPage from "./cabinet/pages/CabinetLessonPlanDetailPage";
import CabinetLessonPlanEditorPage from "./cabinet/pages/CabinetLessonPlanEditorPage";
import CabinetInteractivesPage from "./cabinet/pages/CabinetInteractivesPage";
import CabinetInteractiveCreatePage from "./cabinet/pages/CabinetInteractiveCreatePage";
import CabinetInteractiveEditorPage from "./cabinet/pages/CabinetInteractiveEditorPage";
import CabinetInteractiveDetailPage from "./cabinet/pages/CabinetInteractiveDetailPage";
import CabinetInteractivePlayPage from "./cabinet/pages/CabinetInteractivePlayPage";
import CabinetBoardsPage from "./cabinet/pages/CabinetBoardsPage";
import CabinetBoardEditorPage from "./cabinet/pages/CabinetBoardEditorPage";
import CabinetFilesPage from "./cabinet/pages/CabinetFilesPage";
import VideoMeetingPage from "./cabinet/pages/VideoMeetingPage";
import MeetingCallDock from "./cabinet/components/MeetingCallDock";
import CabinetMorePage from "./cabinet/pages/CabinetMorePage";
import CabinetReportsPage from "./cabinet/CabinetReportsPage";
// TEMP: ИИ-помощник скрыт
// import CabinetAiPage from "./cabinet/CabinetAiPage";
import CabinetUpgradePage from "./cabinet/pages/CabinetUpgradePage";
import CabinetPaymentsPage from "./cabinet/pages/CabinetPaymentsPage";
import CabinetJournalPage from "./cabinet/pages/CabinetJournalPage";
import CabinetJournalAnalyticsPage from "./cabinet/pages/CabinetJournalAnalyticsPage";
import CabinetLessonSummaryPage from "./cabinet/pages/CabinetLessonSummaryPage";
import StudentCabinetPage from "./pages/StudentCabinetPage";
import StudentDashboard from "./cabinet/student/pages/StudentDashboard";
import StudentLessonsPage from "./cabinet/student/pages/StudentLessonsPage";
import StudentLessonDetailPage from "./cabinet/student/pages/StudentLessonDetailPage";
import StudentAssignmentsPage from "./cabinet/student/pages/StudentAssignmentsPage";
import StudentAssignmentDetailPage from "./cabinet/student/pages/StudentAssignmentDetailPage";
import StudentInteractivePlayPage from "./cabinet/student/pages/StudentInteractivePlayPage";
import StudentMaterialsPage from "./cabinet/student/pages/StudentMaterialsPage";
import StudentFilesPage from "./cabinet/student/pages/StudentFilesPage";
import StudentBoardsPage from "./cabinet/student/pages/StudentBoardsPage";
import StudentProfilePage from "./cabinet/student/pages/StudentProfilePage";
import StudentResultsPage from "./cabinet/student/pages/StudentResultsPage";
import StudentTopicsPage from "./cabinet/student/pages/StudentTopicsPage";
import StudentProgressPage from "./cabinet/student/pages/StudentProgressPage";
import StudentMorePage from "./cabinet/student/pages/StudentMorePage";
import ErrorBoundary from "./components/ErrorBoundary";
import { ensureSiteFavicon } from "./utils/ensureSiteFavicon";

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
  if (path === "/lessons" || /^\/lessons\/[^/]+\/view\/?$/.test(path)) {
    return "Готовые уроки и материалы: откройте занятие, просмотрите файл и используйте контент в учебном процессе.";
  }
  if (path === "/interesting" || path.startsWith("/interesting/")) {
    return "Интересное: интерактивные материалы и факты об информатике на платформе «Цифровой поток».";
  }
  if (path === "/teachers" || path === "/for-teachers") {
    return "Решения для учителей: управление классами, планами, домашними заданиями и интерактивными материалами.";
  }
  if (path === "/privacy") {
    return "Политика конфиденциальности платформы «Цифровой поток».";
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

function App() {
  return (
    <BrowserRouter>
      <CyrillicPathRedirect />
      <ScrollToTop />
      <MetaDescriptionSync />
      <Routes>

        <Route element={<Layout />}>

          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<Navigate to="/" replace />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/tasks" element={<AllTasksPage />} />
          <Route path="/generator" element={<Navigate to="/subject" replace />} />
          <Route path="/lessons" element={<ReadyLessonsPage />} />
          <Route path="/lessons/:slug/view" element={<LessonViewerPage />} />
          <Route path="/interesting" element={<InterestingPage />} />
          <Route path="/teachers" element={<ForTeachersPage />} />
          <Route path="/for-teachers" element={<Navigate to="/teachers" replace />} />
          <Route path="/cabinet/login" element={<CabinetAuthPage />} />
          <Route path="/invite/:token" element={<CabinetJoinPage />} />
          <Route path="/invite/:token/" element={<CabinetJoinPage />} />
          <Route path="/cabinet/join/:token" element={<LegacyInviteRedirect />} />
          <Route path="/cabinet/join/:token/" element={<LegacyInviteRedirect />} />
          <Route path="/cabinet/interactives/:id/play" element={<CabinetInteractivePlayPage />} />
          <Route path="/cabinet/boards/:boardId" element={<CabinetBoardEditorPage />} />
          <Route path="/teacher/boards/:boardId" element={<CabinetBoardEditorPage />} />
          <Route path="/cabinet/meetings/:meetingUuid" element={<VideoMeetingPage />} />
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
            <Route path="settings/notifications" element={<CabinetNotificationsSettingsPage />} />
            <Route path="settings/notifications/" element={<CabinetNotificationsSettingsPage />} />
          </Route>
          <Route path="/cabinet" element={<CabinetPage />}>
            <Route index element={<CabinetDashboard />} />
            <Route path="settings/notifications" element={<CabinetNotificationsSettingsPage />} />
            <Route path="settings/notifications/" element={<CabinetNotificationsSettingsPage />} />
            <Route path="students" element={<CabinetStudentsPage />} />
            <Route path="lessons" element={<CabinetLessonsPage />} />
            <Route path="plans" element={<CabinetLessonPlansPage />} />
            <Route path="plans/new" element={<CabinetLessonPlanEditorPage />} />
            <Route path="plans/:planId" element={<CabinetLessonPlanDetailPage />} />
            <Route path="plans/:planId/edit" element={<CabinetLessonPlanEditorPage />} />
            <Route path="interactives" element={<CabinetInteractivesPage />} />
            <Route path="interactives/new" element={<CabinetInteractiveCreatePage />} />
            <Route path="interactives/new/:type" element={<CabinetInteractiveEditorPage />} />
            <Route path="interactives/:id/edit" element={<CabinetInteractiveEditorPage />} />
            <Route path="interactives/:id" element={<CabinetInteractiveDetailPage />} />
            <Route path="boards" element={<CabinetBoardsPage />} />
            <Route path="files" element={<CabinetFilesPage />} />
            <Route path="review/:reviewId" element={<CabinetReviewDetailPage />} />
            <Route path="review" element={<CabinetReviewPage />} />
            <Route path="homework/:homeworkId/edit" element={<CabinetHomeworkEditPage />} />
            <Route path="journal" element={<CabinetJournalPage />} />
            <Route path="journal/analytics" element={<CabinetJournalAnalyticsPage />} />
            <Route path="journal/lesson/:eventId" element={<CabinetLessonSummaryPage />} />
            <Route path="reports" element={<CabinetReportsPage />} />
            <Route path="library" element={<CabinetLibraryPage />} />
            <Route path="schedule" element={<CabinetSchedulePage />} />
            <Route path="payments" element={<CabinetPaymentsPage />} />
            {/* TEMP: ИИ-помощник скрыт */}
            {/* <Route path="ai" element={<CabinetAiPage />} /> */}
            <Route path="more" element={<CabinetMorePage />} />
            <Route path="upgrade" element={<CabinetUpgradePage />} />
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
      <MeetingCallDock />
    </BrowserRouter>
  );
}

export default App;
