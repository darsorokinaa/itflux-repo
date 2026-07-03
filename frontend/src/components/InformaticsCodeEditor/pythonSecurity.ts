/** Статический анализ и whitelist/blacklist модулей для учебного редактора. */

export const ALLOWED_MODULES = new Set([
  "math",
  "random",
  "statistics",
  "fractions",
  "decimal",
  "itertools",
  "functools",
  "collections",
  "datetime",
  "re",
  "string",
  "typing",
  "copy",
  "json",
  "enum",
  "time",
  "abc",
  "heapq",
  "bisect",
  "operator",
  "turtle",
]);

export const BLOCKED_MODULES = new Set([
  "os",
  "sys",
  "subprocess",
  "socket",
  "requests",
  "urllib",
  "urllib3",
  "http",
  "ftplib",
  "smtplib",
  "shutil",
  "pathlib",
  "multiprocessing",
  "threading",
  "ctypes",
  "pickle",
  "shelve",
  "tempfile",
  "glob",
  "signal",
  "resource",
  "importlib",
  "inspect",
  "code",
  "codeop",
  "pty",
  "fcntl",
  "mmap",
  "sqlite3",
  "ssl",
  "asyncio",
  "concurrent",
]);

const IMPORT_RE =
  /^\s*(?:import|from)\s+([a-zA-Z_][\w]*)/gm;

export function findBlockedImports(code: string): string[] {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code)) !== null) {
    const mod = m[1];
    if (BLOCKED_MODULES.has(mod) && !found.includes(mod)) {
      found.push(mod);
    }
  }
  return found;
}

export function blockedImportMessage(module: string): string {
  return `Модуль «${module}» недоступен в учебном редакторе из соображений безопасности.`;
}

/** Python-код, внедряемый в worker перед пользовательским кодом. */
export const PYODIDE_SECURITY_PREAMBLE = `
import builtins as _builtins

_BLOCKED = {${[...BLOCKED_MODULES].map((m) => `"${m}"`).join(", ")}}
_original_import = _builtins.__import__

def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    top = name.split(".")[0]
    if top in _BLOCKED:
        raise ImportError(
            f'Модуль «{top}» недоступен в учебном редакторе из соображений безопасности.'
        )
    return _original_import(name, globals, locals, fromlist, level)

_builtins.__import__ = _safe_import
`;
