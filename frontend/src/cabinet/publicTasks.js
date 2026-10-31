/** r130: банк задач (/tasks) открыт без регистрации; «Мой банк» (/tasks/my…) — только после входа. */
export function isPublicTasksPath(pathname) {
  const p = String(pathname || "").replace(/\/+$/, "");
  return p === "/tasks";
}
