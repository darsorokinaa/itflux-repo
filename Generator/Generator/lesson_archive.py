"""Чтение HTML-урока и ресурсов из ZIP-архива."""

from __future__ import annotations

import json
import mimetypes
import re
import zipfile
from pathlib import Path

from django.http import Http404, HttpResponse
from django.templatetags.static import static

_ARCHIVE_SKIP_PREFIXES = ("__MACOSX/",)
_DRAWING_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def _archive_entry_skipped(name: str) -> bool:
    if any(name.startswith(prefix) for prefix in _ARCHIVE_SKIP_PREFIXES):
        return True
    if name.startswith("._") or "/._" in name:
        return True
    return False


def find_html_entry(namelist: list[str]) -> str | None:
    candidates = [
        name
        for name in namelist
        if not _archive_entry_skipped(name)
        and name.lower().endswith(".html")
        and not name.endswith("/")
    ]
    if not candidates:
        return None

    for entry in candidates:
        filename = entry.rsplit("/", 1)[-1].lower()
        if filename in ("index.html", "lesson.html"):
            return entry

    candidates.sort(key=lambda name: (name.count("/"), len(name)))
    return candidates[0]


def archive_base_dir(html_entry: str) -> str:
    if "/" not in html_entry:
        return ""
    return html_entry.rsplit("/", 1)[0] + "/"


def inject_base_href(html: str, base_href: str) -> str:
    tag = f'<base href="{base_href}">'
    if re.search(r"<head\b", html, re.I):
        return re.sub(r"(<head[^>]*>)", rf"\1\n  {tag}", html, count=1, flags=re.I)
    if re.search(r"<html\b", html, re.I):
        return re.sub(r"(<html[^>]*>)", rf"\1\n<head>{tag}</head>", html, count=1, flags=re.I)
    return f"<!DOCTYPE html><html><head>{tag}</head><body>{html}</body></html>"


def resolve_archive_asset(namelist: list[str], asset_path: str, html_entry: str) -> str | None:
    asset_path = (asset_path or "").replace("\\", "/").lstrip("/")
    if not asset_path or ".." in asset_path.split("/"):
        return None
    if _archive_entry_skipped(asset_path):
        return None
    if asset_path in namelist:
        return asset_path
    base = archive_base_dir(html_entry)
    combined = f"{base}{asset_path}" if base else asset_path
    if combined in namelist:
        return combined
    return None


def inject_lesson_content_styles(html: str, request) -> str:
    css_url = request.build_absolute_uri(static("css/lesson-content.css"))
    tag = f'<link rel="stylesheet" href="{css_url}">'
    if "lesson-content.css" in html:
        return html
    if re.search(r"<head\b", html, re.I):
        return re.sub(r"(<head[^>]*>)", rf"\1\n  {tag}", html, count=1, flags=re.I)
    if re.search(r"<html\b", html, re.I):
        return re.sub(r"(<html[^>]*>)", rf"\1\n<head>{tag}</head>", html, count=1, flags=re.I)
    return f"<!DOCTYPE html><html><head>{tag}</head><body>{html}</body></html>"


def inject_lesson_drawing_assets(html: str, request, slug: str) -> str:
    """Встраиваем CSS/JS в HTML, чтобы панель не зависела от кэша /static/."""
    if 'id="lesson-slide-drawing-js"' in html:
        return html
    css_path = _DRAWING_STATIC_DIR / "css" / "lesson-slide-drawing.css"
    js_path = _DRAWING_STATIC_DIR / "js" / "lesson-slide-drawing.js"
    config = json.dumps({"slug": slug}, ensure_ascii=False)
    if css_path.is_file() and js_path.is_file():
        css = css_path.read_text(encoding="utf-8")
        js = js_path.read_text(encoding="utf-8").replace("</", "<\\/")
        block = (
            f'<style id="lesson-slide-drawing-css">\n{css}\n</style>\n'
            f"<script>window.__LESSON_DRAWING__={config};</script>\n"
            f'<script id="lesson-slide-drawing-js">\n{js}\n</script>\n'
        )
    else:
        css_url = request.build_absolute_uri(static("css/lesson-slide-drawing.css"))
        js_url = request.build_absolute_uri(static("js/lesson-slide-drawing.js"))
        block = (
            f'<link rel="stylesheet" href="{css_url}?v=2">\n'
            f"<script>window.__LESSON_DRAWING__={config};</script>\n"
            f'<script src="{js_url}?v=2"></script>\n'
        )
    if re.search(r"</body>", html, re.I):
        return re.sub(r"</body>", block + "</body>", html, count=1, flags=re.I)
    return html + block


def read_lesson_file_html(
    file_path: str,
    base_href: str,
    request=None,
    slug: str = "",
) -> str:
    try:
        with open(file_path, "rb") as f:
            raw = f.read()
    except FileNotFoundError as exc:
        raise Http404("Файл урока не найден") from exc

    html = None
    for encoding in ("utf-8", "utf-8-sig", "cp1251"):
        try:
            html = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if html is None:
        html = raw.decode("utf-8", errors="replace")
    html = inject_base_href(html, base_href)
    if request:
        html = inject_lesson_content_styles(html, request)
    if request and slug:
        html = inject_lesson_drawing_assets(html, request, slug)
    return html


def lesson_file_base_href(request, lesson, slug: str = "") -> str:
    slug = slug or getattr(lesson, "slug", "") or ""
    path = f"/api/lessons/{slug}/assets/"
    base_href = request.build_absolute_uri(path)
    if not base_href.endswith("/"):
        base_href += "/"
    return base_href


def resolve_lesson_file_asset(lesson, asset_path: str) -> str | None:
    """Resolve relative asset path against the lesson HTML file directory."""
    if not getattr(lesson, "file", None) or not lesson.file.name:
        return None
    asset_path = (asset_path or "").replace("\\", "/").lstrip("/")
    if not asset_path or ".." in asset_path.split("/"):
        return None
    file_dir = lesson.file.name.replace("\\", "/").rsplit("/", 1)[0]
    combined = f"{file_dir}/{asset_path}" if file_dir else asset_path
    return combined


def lesson_file_asset_response(lesson, storage_path: str):
    import os

    from django.conf import settings

    abs_path = os.path.join(settings.MEDIA_ROOT, storage_path.replace("\\", "/"))
    media_root = os.path.abspath(settings.MEDIA_ROOT)
    if not os.path.abspath(abs_path).startswith(media_root):
        raise Http404("Файл не найден")
    if not os.path.isfile(abs_path):
        raise Http404("Файл не найден")
    try:
        with open(abs_path, "rb") as handle:
            data = handle.read()
    except OSError as exc:
        raise Http404("Файл не найден") from exc
    content_type = mimetypes.guess_type(storage_path)[0] or "application/octet-stream"
    response = HttpResponse(data, content_type=content_type)
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


def _decode_html_bytes(raw: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1251"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def inject_demo_overlay(
    html: str,
    *,
    partial: bool = False,
    expires_at: str = "",
    slug: str = "",
    preview_url: str = "",
) -> str:
    """Watermark + demo timer. Контент и вёрстка урока не меняются."""
    tiles = "".join(
        f'<span class="itflux-demo-wm__tile" style="top:{y}%;left:{x}%">ДЕМОВЕРСИЯ · ЦИФРОВОЙ ПОТОК</span>'
        for y in range(-6, 118, 28)
        for x in range(-10, 108, 38)
    )
    continue_html = (
        '<div class="itflux-demo-continue">Продолжение доступно в полной версии.</div>'
        if partial
        else ""
    )
    timer_html = (
        '<div class="itflux-demo-timer" id="itflux-demo-timer" aria-live="polite">'
        "Демоверсия · осталось — мин"
        "</div>"
        if expires_at
        else ""
    )
    poll_url = f"/api/lessons/{slug}/" if slug else ""
    preview = preview_url or (f"/lessons?preview={slug}" if slug else "/lessons")
    timer_script = ""
    if expires_at and poll_url:
        timer_script = f"""
<script id="itflux-demo-timer-script">
(function() {{
  var expiresAt = new Date({json.dumps(expires_at)});
  var timerEl = document.getElementById("itflux-demo-timer");
  var previewUrl = {json.dumps(preview)};
  var pollUrl = {json.dumps(poll_url)};
  function formatRemaining(ms) {{
    var total = Math.max(0, Math.floor(ms / 1000));
    var minutes = Math.ceil(total / 60);
    return minutes;
  }}
  function updateTimer() {{
    if (!timerEl) return;
    var remaining = expiresAt.getTime() - Date.now();
    if (remaining <= 0) {{
      timerEl.textContent = "Демоверсия закончилась";
      window.location.href = previewUrl + (previewUrl.includes("?") ? "&" : "?") + "demo_expired=1";
      return;
    }}
    timerEl.textContent = "Демоверсия · осталось " + formatRemaining(remaining) + " мин";
  }}
  function checkAccess() {{
    fetch(pollUrl, {{ credentials: "same-origin" }})
      .then(function(res) {{ return res.ok ? res.json() : null; }})
      .then(function(data) {{
        var access = data && data.lesson && data.lesson.access;
        if (!access || access.content_mode !== "demo" || !access.demo_active) {{
          window.location.href = previewUrl + (previewUrl.includes("?") ? "&" : "?") + "demo_expired=1";
        }}
      }})
      .catch(function() {{}});
  }}
  updateTimer();
  setInterval(updateTimer, 15000);
  setInterval(checkAccess, 30000);
}})();
</script>
"""
    snippet = f"""
<style id="itflux-demo-style">
  .itflux-demo-timer {{
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483002; margin: 0;
    padding: 8px 14px; background: rgba(255, 247, 237, 0.94); color: #9a3412;
    font: 650 13px/1.3 system-ui, sans-serif; text-align: center; pointer-events: none;
  }}
  .itflux-demo-wm {{ position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; overflow: hidden; }}
  .itflux-demo-wm__tile {{
    position: absolute; transform: rotate(-26deg); font-weight: 700; font-size: clamp(16px, 2.6vw, 30px);
    letter-spacing: .06em; color: rgba(180, 48, 48, .09); white-space: nowrap; user-select: none;
    font-family: system-ui, sans-serif;
  }}
  .itflux-demo-continue {{
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483001; margin: 0;
    padding: 12px 16px; background: rgba(255, 250, 244, 0.94); border-top: 1px solid #eadfce;
    color: #3f2f22; font-family: system-ui, sans-serif; font-weight: 650; font-size: 14px;
    text-align: center;
  }}
</style>
{timer_html}
<div class="itflux-demo-wm" aria-hidden="true">{tiles}</div>
{continue_html}
{timer_script}
"""
    if re.search(r"</body>", html, re.I):
        return re.sub(r"</body>", snippet + "</body>", html, count=1, flags=re.I)
    return html + snippet


def inject_full_overlay(html: str, *, label: str = "") -> str:
    """Delicate watermark for full-access viewing."""
    text = label or "Цифровой поток"
    tiles = "".join(
        f'<span class="itflux-full-wm__tile" style="top:{y}%;left:{x}%">{text}</span>'
        for y in range(10, 110, 34)
        for x in range(8, 92, 36)
    )
    snippet = f"""
<style id="itflux-full-wm-style">
  .itflux-full-wm {{ position: fixed; inset: 0; pointer-events: none; z-index: 2147482000; overflow: hidden; }}
  .itflux-full-wm__tile {{
    position: absolute; transform: rotate(-24deg); font-weight: 600; font-size: clamp(12px, 1.8vw, 20px);
    letter-spacing: .04em; color: rgba(36, 28, 22, .06); white-space: nowrap; user-select: none;
    font-family: system-ui, sans-serif;
  }}
</style>
<div class="itflux-full-wm" aria-hidden="true">{tiles}</div>
"""
    if re.search(r"</body>", html, re.I):
        return re.sub(r"</body>", snippet + "</body>", html, count=1, flags=re.I)
    return html + snippet


def read_archive_html(
    zf: zipfile.ZipFile,
    html_entry: str,
    base_href: str,
    request=None,
    slug: str = "",
) -> str:
    html = inject_base_href(_decode_html_bytes(zf.read(html_entry)), base_href)
    if request:
        html = inject_lesson_content_styles(html, request)
    if request and slug:
        html = inject_lesson_drawing_assets(html, request, slug)
    return html


def read_plain_archive_html(zf: zipfile.ZipFile, html_entry: str, base_href: str) -> str:
    """HTML из ZIP без уроковых CSS/JS (для раздела «Интересное»)."""
    return inject_base_href(_decode_html_bytes(zf.read(html_entry)), base_href)


def read_plain_file_html(file_path: str, base_href: str) -> str:
    try:
        with open(file_path, "rb") as f:
            raw = f.read()
    except FileNotFoundError as exc:
        raise Http404("Файл не найден") from exc
    return inject_base_href(_decode_html_bytes(raw), base_href)


def archive_asset_response(zf: zipfile.ZipFile, entry: str) -> HttpResponse:
    data = zf.read(entry)
    content_type = mimetypes.guess_type(entry)[0] or "application/octet-stream"
    response = HttpResponse(data, content_type=content_type)
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


def open_lesson_archive(archive_path: str):
    if not archive_path:
        raise Http404("Архив урока не найден")
    try:
        return zipfile.ZipFile(archive_path)
    except FileNotFoundError as exc:
        raise Http404("Файл архива не найден") from exc
    except zipfile.BadZipFile as exc:
        raise Http404("Архив повреждён") from exc
