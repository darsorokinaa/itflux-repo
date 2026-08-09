import { Navigate } from "react-router-dom";

/** Выбор типа перенесён в сайдбар редактора — сразу открываем билдер. */
export default function CabinetInteractiveCreatePage() {
  return <Navigate to="/cabinet/interactives/new/wheel" replace />;
}
