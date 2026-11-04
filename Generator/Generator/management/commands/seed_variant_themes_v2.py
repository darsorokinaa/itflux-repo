"""Создаёт/обновляет темы вариантов space, mountains, winter из каталога с файлами.

Идемпотентно: тема ищется по slug; файл заменяется только если его содержимое
(sha256) отличается от уже сохранённого. По умолчанию is_published=False.

  python manage.py seed_variant_themes_v2 --source /path/variant_themes_new --dry-run
  python manage.py seed_variant_themes_v2 --source /path/variant_themes_new
  python manage.py seed_variant_themes_v2 --source ... --publish
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from Generator.variant_theme_models import VariantTheme
from Generator.variant_theme_service import sanitize_variant_theme_config

THEMES = {
    "space": {"name": "Космос", "layout_type": "route", "description": "Тёмный космос со звёздами"},
    "mountains": {"name": "Горы", "layout_type": "route", "description": "Рассвет в горах"},
    "winter": {"name": "Зима", "layout_type": "route", "description": "Снежный зимний лес"},
}

# поле модели -> роль в имени файла
ROLE_FIELDS = (
    ("preview_image", "preview", (".webp",)),
    ("background_image", "bg_landscape", (".webp", ".jpg")),
    ("background_image_vertical", "bg_portrait", (".webp",)),
    ("block_background_image", "block", (".webp",)),
    ("sheet_background_image", "sheet_landscape", (".jpg",)),
    ("sheet_background_image_vertical", "sheet_portrait", (".jpg",)),
)


def _sha(fileobj) -> str:
    h = hashlib.sha256()
    for chunk in iter(lambda: fileobj.read(1 << 16), b""):
        h.update(chunk)
    fileobj.seek(0)
    return h.hexdigest()


def _stored_sha(field) -> str | None:
    if not field:
        return None
    try:
        with field.storage.open(field.name, "rb") as fh:
            return _sha(fh)
    except Exception:
        return None


def config_from_tokens(tokens: dict) -> dict:
    bg = {"type": "image", "color": tokens.get("bg_color", "")}
    raw = {
        "labels": tokens.get("labels") or {},
        "decorations": tokens.get("decorations") or [],
        "animation": tokens.get("animation") or "none",
        "background": bg,
        "theme_mode": tokens.get("theme_mode") or "light",
        "tokens": {
            "accent": tokens.get("accent"),
            "accent_hover": tokens.get("accent_hover"),
            "on_accent": tokens.get("on_accent"),
            "page_text_primary": tokens.get("page_text_primary") or (
                tokens.get("text_primary") if tokens.get("theme_mode") == "dark" else None
            ),
            "page_text_secondary": tokens.get("page_text_secondary") or (
                tokens.get("text_secondary") if tokens.get("theme_mode") == "dark" else None
            ),
            "card_text_secondary": tokens.get("card_text_secondary"),
            "hero_overlay": tokens.get("hero_overlay"),
        },
    }
    return sanitize_variant_theme_config(raw)


class Command(BaseCommand):
    help = "Создать/обновить темы вариантов Космос, Горы, Зима (идемпотентно)."

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True, help="Каталог с <slug>/<slug>__<role>.<ext>")
        parser.add_argument("--only", nargs="*", choices=sorted(THEMES), help="Только эти slug")
        parser.add_argument("--publish", action="store_true", help="Поставить is_published=True")
        parser.add_argument("--dry-run", action="store_true", help="Ничего не записывать")

    def handle(self, *args, **opts):
        source = Path(opts["source"]).expanduser()
        if not source.is_dir():
            raise CommandError(f"Нет каталога {source}")
        dry = opts["dry_run"]
        slugs = opts["only"] or list(THEMES)
        plan = []
        for slug in slugs:
            folder = source / slug
            tokens_path = folder / f"{slug}__tokens.json"
            if not tokens_path.exists():
                raise CommandError(f"Нет {tokens_path}")
            tokens = json.loads(tokens_path.read_text(encoding="utf-8"))
            files = {}
            for field, role, exts in ROLE_FIELDS:
                found = next((folder / f"{slug}__{role}{ext}" for ext in exts if (folder / f"{slug}__{role}{ext}").exists()), None)
                if found is None:
                    raise CommandError(f"{slug}: нет файла роли {role} ({'/'.join(exts)})")
                files[field] = found
            plan.append((slug, tokens, files))

        with transaction.atomic():
            for slug, tokens, files in plan:
                self._apply(slug, tokens, files, publish=opts["publish"], dry=dry)
            if dry:
                transaction.set_rollback(True)
        self.stdout.write(self.style.WARNING("DRY-RUN: ничего не записано") if dry else self.style.SUCCESS("Готово"))

    def _apply(self, slug, tokens, files, *, publish, dry):
        meta = THEMES[slug]
        theme = VariantTheme.objects.filter(slug=slug).first()
        created = theme is None
        if created:
            theme = VariantTheme(slug=slug, is_active=True, is_published=False)
        config = config_from_tokens(tokens)
        changes = []
        for attr, value in (("name", meta["name"]), ("description", meta["description"]),
                            ("layout_type", meta["layout_type"]), ("config", config)):
            if getattr(theme, attr) != value:
                changes.append(attr)
                setattr(theme, attr, value)
        if publish and not theme.is_published:
            theme.is_published = True
            changes.append("is_published")
        uploads = []
        for field, path in files.items():
            with path.open("rb") as fh:
                new_sha = _sha(fh)
            if created or _stored_sha(getattr(theme, field)) != new_sha:
                uploads.append((field, path))
        self.stdout.write(
            f"[{slug}] {'CREATE' if created else 'UPDATE'} "
            f"fields={changes or '-'} upload={[f'{f}<-{p.name}' for f, p in uploads] or '-'} "
            f"published={theme.is_published} mode={config.get('theme_mode')}"
        )
        if dry:
            return
        if changes or created:
            theme.save()
        for field, path in uploads:
            with path.open("rb") as fh:
                # upload_to кладёт в variant-themes/<slug>/<uuid>.<ext>
                getattr(theme, field).save(path.name, File(fh), save=False)
        if uploads:
            theme.save()
