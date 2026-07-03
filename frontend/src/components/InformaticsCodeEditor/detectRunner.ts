/** Определяет, нужен ли Skulpt (turtle) или Pyodide для запуска. */

const TURTLE_RE =
  /\b(?:import\s+turtle|from\s+turtle\s+import)\b/;

export function usesTurtle(code: string, allFiles: Record<string, string>): boolean {
  if (TURTLE_RE.test(code)) return true;
  return Object.values(allFiles).some((c) => TURTLE_RE.test(c));
}

export type RunnerKind = "pyodide" | "skulpt";

export function pickRunner(
  mainCode: string,
  allFiles: Record<string, string>
): RunnerKind {
  return usesTurtle(mainCode, allFiles) ? "skulpt" : "pyodide";
}
