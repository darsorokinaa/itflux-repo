"""Watermark paid demo content so the original asset is never returned as-is."""

from __future__ import annotations

import io
import logging
import mimetypes

from django.http import HttpResponse

from .files_storage import content_disposition

logger = logging.getLogger(__name__)

WATERMARK_TEXT = "ДЕМО · ЦИФРОВОЙ ПОТОК"
CONTINUATION_MESSAGE = "Продолжение доступно в полной версии."


def _guess_type(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def watermark_image_bytes(data: bytes, *, mime: str = "image/png") -> tuple[bytes, str]:
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    elif image.mode == "RGB":
        image = image.convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = image.size
    font_size = max(24, min(width, height) // 11)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), WATERMARK_TEXT, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    step_x = max(tw + 80, width // 3)
    step_y = max(th + 90, height // 4)
    for y in range(-height // 4, height + step_y, step_y):
        for x in range(-width // 4, width + step_x, step_x):
            draw.text((x, y), WATERMARK_TEXT, font=font, fill=(196, 48, 48, 40))
    stamped = Image.alpha_composite(image, overlay)
    out = io.BytesIO()
    fmt = "PNG" if "png" in (mime or "") else "JPEG"
    if fmt == "JPEG":
        stamped = stamped.convert("RGB")
        stamped.save(out, format="JPEG", quality=82)
        return out.getvalue(), "image/jpeg"
    stamped.save(out, format="PNG")
    return out.getvalue(), "image/png"


def _watermark_pdf_overlay_bytes() -> bytes | None:
    html = f"""
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          @page {{ size: A4; margin: 0; }}
          html, body {{ margin: 0; padding: 0; width: 210mm; height: 297mm; }}
          .tile {{
            position: absolute;
            color: rgba(196, 48, 48, 0.14);
            font-size: 34px;
            font-weight: 800;
            letter-spacing: 0.08em;
            transform: rotate(-32deg);
            white-space: nowrap;
            font-family: DejaVu Sans, sans-serif;
          }}
        </style>
      </head>
      <body>
        {''.join(
            f'<div class="tile" style="top:{y}mm;left:{x}mm">{WATERMARK_TEXT}</div>'
            for y in range(-20, 300, 55)
            for x in range(-40, 220, 90)
        )}
      </body>
    </html>
    """
    try:
        from weasyprint import HTML

        return HTML(string=html).write_pdf()
    except Exception:
        logger.exception("demo_watermark_pdf_overlay_failed")
        return None


def watermark_pdf_bytes(data: bytes) -> bytes | None:
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        logger.warning("pypdf is not installed; cannot watermark PDF demo")
        return None
    overlay_bytes = _watermark_pdf_overlay_bytes()
    if not overlay_bytes:
        return None
    try:
        reader = PdfReader(io.BytesIO(data))
        overlay = PdfReader(io.BytesIO(overlay_bytes)).pages[0]
        writer = PdfWriter()
        for page in reader.pages:
            try:
                page.merge_page(overlay)
            except Exception:
                pass
            writer.add_page(page)
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        logger.exception("demo_watermark_pdf_merge_failed")
        return None


def slice_pdf_pages(data: bytes, page_count: int) -> bytes | None:
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        logger.warning("pypdf is not installed; cannot slice PDF demo")
        return None
    try:
        reader = PdfReader(io.BytesIO(data))
        writer = PdfWriter()
        limit = max(1, int(page_count or 1))
        for index, page in enumerate(reader.pages):
            if index >= limit:
                break
            writer.add_page(page)
        if not writer.pages:
            return None
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        logger.exception("demo_pdf_slice_failed")
        return None


def demo_file_response(material, *, inline: bool = True):
    """Serve watermarked demo content. Never returns the original downloadable asset."""
    from .choices import MaterialDemoMode
    from .lesson_access import LessonAccessService

    partial = LessonAccessService.is_partial_demo(material)
    page_limit = LessonAccessService.demo_page_limit(material)
    source = None
    name = "demo"
    if material.file:
        try:
            source = material.file.open("rb")
            name = material.file.name.split("/")[-1] or "demo"
        except Exception:
            source = None
    if source is None and getattr(material, "cabinet_file_id", None):
        try:
            from .files_storage import open_file

            source = open_file(material.cabinet_file.storage_key, "rb")
            name = material.cabinet_file.original_name or "demo"
        except Exception:
            source = None

    fragment = LessonAccessService.demo_visible_content(material)
    if source is None:
        body = fragment or "Фрагмент демоверсии недоступен."
        if partial:
            body = f"{body}<p><strong>{CONTINUATION_MESSAGE}</strong></p>"
        return HttpResponse(
            _demo_html_wrapper(material, body=body),
            content_type="text/html; charset=utf-8",
        )

    raw = source.read()
    try:
        source.close()
    except Exception:
        pass
    mime = _guess_type(name)
    if mime.startswith("image/") and mime not in ("image/svg+xml",):
        stamped, mime = watermark_image_bytes(raw, mime=mime)
        response = HttpResponse(stamped, content_type=mime)
        response["Content-Disposition"] = content_disposition(f"demo-{name}", inline=True)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        response["X-Material-Access"] = "demo"
        response["X-Material-Demo-Mode"] = (
            MaterialDemoMode.PARTIAL if partial else MaterialDemoMode.FULL_WATERMARKED
        )
        return response
    if mime == "application/pdf" or name.lower().endswith(".pdf"):
        payload = raw
        if partial:
            sliced = slice_pdf_pages(raw, page_limit)
            if sliced is None:
                return HttpResponse(
                    _demo_html_wrapper(
                        material,
                        body=f"{fragment or 'Демоверсия доступна ограниченным фрагментом.'}"
                        f"<p><strong>{CONTINUATION_MESSAGE}</strong></p>",
                    ),
                    content_type="text/html; charset=utf-8",
                )
            payload = sliced
        stamped = watermark_pdf_bytes(payload)
        if stamped:
            response = HttpResponse(stamped, content_type="application/pdf")
            response["Content-Disposition"] = content_disposition(f"demo-{name}", inline=True)
            response["X-Content-Type-Options"] = "nosniff"
            response["Cache-Control"] = "private, no-store"
            response["X-Material-Access"] = "demo"
            return response
        return HttpResponse(
            _demo_html_wrapper(material, body="Демоверсия PDF временно недоступна."),
            content_type="text/html; charset=utf-8",
        )
    if mime.startswith("text/") and mime not in ("text/html", "text/javascript"):
        text = raw.decode("utf-8", errors="replace")
        if partial:
            text = text[:1200]
        body = f"<pre>{_escape(text)}</pre>"
        if partial:
            body += f"<p><strong>{CONTINUATION_MESSAGE}</strong></p>"
        return HttpResponse(
            _demo_html_wrapper(material, body=body),
            content_type="text/html; charset=utf-8",
        )
    body = fragment or (
        "Демоверсия этого типа файла доступна только для просмотра с водяными знаками. "
        "Скачивание оригинала отключено."
    )
    if partial:
        body += f"<p><strong>{CONTINUATION_MESSAGE}</strong></p>"
    return HttpResponse(
        _demo_html_wrapper(material, body=body),
        content_type="text/html; charset=utf-8",
    )


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _demo_html_wrapper(material, body: str) -> str:
    title = _escape(getattr(material, "title", "") or "Материал")
    tiles = "".join(
        f'<span class="wm" style="top:{y}%;left:{x}%">{WATERMARK_TEXT}</span>'
        for y in range(-10, 120, 22)
        for x in range(-15, 110, 32)
    )
    return f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Демоверсия · {title}</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #f7f4ef; color: #241c16; }}
    .wrap {{ position: relative; min-height: 100vh; overflow: hidden; padding: 48px 24px; }}
    .wm {{
      position: absolute; transform: rotate(-28deg); font-weight: 800; font-size: 42px;
      letter-spacing: .08em; color: rgba(196,48,48,.14); white-space: nowrap; pointer-events: none;
      user-select: none;
    }}
    .card {{ position: relative; max-width: 720px; margin: 0 auto; background: #fff;
      border-radius: 16px; padding: 24px; box-shadow: 0 10px 40px rgba(40,24,8,.08); }}
    h1 {{ font-size: 22px; margin: 0 0 12px; }}
    .badge {{ display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .08em;
      color: #b42318; background: #fee4e2; border-radius: 999px; padding: 4px 10px; margin-bottom: 12px; }}
    pre {{ white-space: pre-wrap; word-break: break-word; font-size: 14px; }}
  </style>
</head>
<body>
  <div class="wrap">
    {tiles}
    <div class="card">
      <div class="badge">ДЕМО-ВЕРСИЯ</div>
      <h1>{title}</h1>
      {body}
    </div>
  </div>
</body>
</html>"""
