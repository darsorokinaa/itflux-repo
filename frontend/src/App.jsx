import { useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useNavigate } from "react-router-dom";

import Layout from "./pages/Layout";
import HomePage from "./pages/HomePage";
import AllTasksPage from "./pages/AllTasksPage";
import GeneratorHubPage from "./pages/GeneratorHubPage";
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
import ForTeachersPage from "./pages/ForTeachersPage";
import CabinetAuthPage from "./pages/CabinetAuthPage";
import CabinetJoinPage from "./cabinet/pages/CabinetJoinPage";
import CabinetPage from "./pages/CabinetPage";
import CabinetDashboard from "./cabinet/CabinetDashboard";
import CabinetStudentsPage from "./cabinet/pages/CabinetStudentsPage";
import CabinetLessonsPage from "./cabinet/pages/CabinetLessonsPage";
import CabinetReviewPage from "./cabinet/pages/CabinetReviewPage";
import CabinetReviewDetailPage from "./cabinet/pages/CabinetReviewDetailPage";
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
import CabinetMorePage from "./cabinet/pages/CabinetMorePage";
import CabinetAiPage from "./cabinet/CabinetAiPage";
import CabinetUpgradePage from "./cabinet/pages/CabinetUpgradePage";
import StudentCabinetPage from "./pages/StudentCabinetPage";
import StudentDashboard from "./cabinet/student/pages/StudentDashboard";
import StudentLessonsPage from "./cabinet/student/pages/StudentLessonsPage";
import StudentLessonDetailPage from "./cabinet/student/pages/StudentLessonDetailPage";
import StudentAssignmentsPage from "./cabinet/student/pages/StudentAssignmentsPage";
import StudentAssignmentDetailPage from "./cabinet/student/pages/StudentAssignmentDetailPage";
import StudentInteractivesPage from "./cabinet/student/pages/StudentInteractivesPage";
import StudentInteractivePlayPage from "./cabinet/student/pages/StudentInteractivePlayPage";
import StudentSchedulePage from "./cabinet/student/pages/StudentSchedulePage";
import StudentMaterialsPage from "./cabinet/student/pages/StudentMaterialsPage";
import StudentProfilePage from "./cabinet/student/pages/StudentProfilePage";
import StudentMorePage from "./cabinet/student/pages/StudentMorePage";
import ErrorBoundary from "./components/ErrorBoundary";
import { ensureSiteFavicon } from "./utils/ensureSiteFavicon";

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
      <Routes>

        <Route element={<Layout />}>

          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<Navigate to="/" replace />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/tasks" element={<AllTasksPage />} />
          <Route path="/generator" element={<GeneratorHubPage />} />
          <Route path="/lessons" element={<ReadyLessonsPage />} />
          <Route path="/lessons/:slug/view" element={<LessonViewerPage />} />
          <Route path="/teachers" element={<ForTeachersPage />} />
          <Route path="/for-teachers" element={<Navigate to="/teachers" replace />} />
          <Route path="/cabinet/login" element={<CabinetAuthPage />} />
          <Route path="/cabinet/join/:token" element={<CabinetJoinPage />} />
          <Route path="/cabinet/interactives/:id/play" element={<CabinetInteractivePlayPage />} />
          <Route path="/cabinet/student" element={<StudentCabinetPage />}>
            <Route index element={<StudentDashboard />} />
            {/* === Основные вкладки MVP === */}
            <Route path="lessons"          element={<StudentLessonsPage />} />
            <Route path="lessons/:id"      element={<StudentLessonDetailPage />} />
            <Route path="assignments"      element={<StudentAssignmentsPage />} />
            <Route path="assignments/:id"  element={<StudentAssignmentDetailPage />} />
            <Route path="profile"          element={<StudentProfilePage />} />
            {/* === Интерактив плеер (полноэкранный, без шапки) === */}
            <Route path="interactives/:id/play" element={<StudentInteractivePlayPage />} />
            {/* === Редиректы удалённых разделов === */}
            <Route path="interactives" element={<Navigate to="/cabinet/student/assignments" replace />} />
            <Route path="schedule"     element={<Navigate to="/cabinet/student/lessons" replace />} />
            <Route path="progress"     element={<Navigate to="/cabinet/student" replace />} />
            <Route path="materials"    element={<Navigate to="/cabinet/student/lessons" replace />} />
            <Route path="more"         element={<Navigate to="/cabinet/student" replace />} />
          </Route>
          <Route path="/cabinet" element={<CabinetPage />}>
            <Route index element={<CabinetDashboard />} />
            <Route path="students" element={<CabinetStudentsPage />} />
            <Route path="lessons" element={<CabinetLessonsPage />} />
            <Route path="plans" element={<CabinetLessonPlansPage />} />
            <Route path="plans/new" element={<CabinetLessonPlanEditorPage />} />
            <Route path="plans/:planId" element={<CabinetLessonPlanDetailPage />} />
            <Route path="plans/:planId/edit" element={<CabinetLessonPlanEditorPage />} />
            <Route path="interactives/new/:type" element={<CabinetInteractiveEditorPage />} />
            <Route path="interactives/:id/edit" element={<CabinetInteractiveEditorPage />} />
            <Route path="interactives/new" element={<CabinetInteractiveCreatePage />} />
            <Route path="interactives/:id" element={<CabinetInteractiveDetailPage />} />
            <Route path="interactives" element={<CabinetInteractivesPage />} />
            <Route path="review/:reviewId" element={<CabinetReviewDetailPage />} />
            <Route path="review" element={<CabinetReviewPage />} />
            <Route path="reports" element={<Navigate to="/cabinet" replace />} />
            <Route path="library" element={<CabinetLibraryPage />} />
            <Route path="schedule" element={<CabinetSchedulePage />} />
            <Route path="ai" element={<CabinetAiPage />} />
            <Route path="more" element={<CabinetMorePage />} />
            <Route path="upgrade" element={<CabinetUpgradePage />} />
          </Route>
          <Route path="/login" element={<Navigate to="/cabinet/login" replace />} />
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
    </BrowserRouter>
  );
}

export default App;
