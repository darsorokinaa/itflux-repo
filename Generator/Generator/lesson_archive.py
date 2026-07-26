"""Чтение HTML-урока и ресурсов из ZIP-архива."""

from __future__ import annotations

import json
import mimetypes
import re
import zipfile

from django.http import Http404, HttpResponse
from django.templatetags.static import static

_ARCHIVE_SKIP_PREFIXES = ("__MACOSX/",)


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
    css_url = request.build_absolute_uri(static("css/lesson-slide-drawing.css"))
    js_url = request.build_absolute_uri(static("js/lesson-slide-drawing.js"))
    config = json.dumps({"slug": slug}, ensure_ascii=False)
    block = (
        f'<link rel="stylesheet" href="{css_url}">\n'
        f"<script>window.__LESSON_DRAWING__={config};</script>\n"
        f'<script src="{js_url}" defer></script>\n'
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


def lesson_file_base_href(request, lesson) -> str:
    file_dir = (lesson.file.name or "").replace("\\", "/").rsplit("/", 1)[0]
    path = f"/media/{file_dir}/" if file_dir else "/media/"
    base_href = request.build_absolute_uri(path)
    if not base_href.endswith("/"):
        base_href += "/"
    return base_href


def _decode_html_bytes(raw: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1251"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


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
    if content_type.startswith("image/") or content_type in {
        "text/css",
        "application/javascript",
        "font/woff",
        "font/woff2",
    }:
        response["Cache-Control"] = "public, max-age=86400"
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
