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
            element={<ExamPage />}
          />

          <Route path="*" element={<NotFoundPage />} />

        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;
