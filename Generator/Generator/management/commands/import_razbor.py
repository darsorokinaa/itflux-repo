"""r131: импорт разборов из .md.

  manage.py import_razbor FILE.md [...] [--img-root DIR] [--publish] [--dry-run]

Имя файла: <exam>_<subject>_<NN>.md (oge_math_01.md, ege_inf_27.md).
Первый «# заголовок» становится title. Пути картинок …/img/<rel> -> /media/<rel>;
если /media/<rel> нет на сервере, файл копируется из --img-root/<rel>.
Перед сохранением: ответы примеров с task_id сверяются с базой, формулы рендерятся
MathJax, картинки открываются. Файл с проблемами сохраняется НЕопубликованным.
"""
import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from Generator.razbor_models import Razbor
from Generator import razbor_quality as q

NAME_RE = re.compile(r"^(oge|ege)_([a-z_]+?)_(\d+)\.md$")


class Command(BaseCommand):
    help = "Импорт разборов заданий (Markdown + LaTeX) с проверкой качества"

    def add_arguments(self, parser):
        parser.add_argument("files", nargs="+")
        parser.add_argument("--img-root", default="", help="Папка с исходными картинками (то, что после /img/)")
        parser.add_argument("--publish", action="store_true", help="Опубликовать файлы без проблем")
        parser.add_argument("--dry-run", action="store_true", help="Только проверка, без записи")
        parser.add_argument("--frontend-dir", default=str(Path(settings.BASE_DIR).parent / "frontend"))

    def handle(self, *args, **o):
        files = o["files"]
        bad = 0
        for f in files:
            p = Path(f)
            m = NAME_RE.match(p.name)
            if not m:
                raise CommandError(f"{p.name}: имя должно быть <exam>_<subject>_<NN>.md")
            exam, subject, number = m.group(1), m.group(2), int(m.group(3))
            raw = p.read_text(encoding="utf-8")
            h1 = re.search(r"^#\s+(.+)$", raw, re.M)
            title = (h1.group(1).strip() if h1 else f"Задание №{number}")
            title = re.sub(r"\.?\s*Методическое руководство\.?$", "", title).strip()
            title = re.sub(r"№\s+(?=\d)", "№", title)  # r133
            body = raw[h1.end():].lstrip("\n") if h1 else raw

            probs = []
            probs += q.answer_problems(body, exam, subject, number)
            probs += q.latex_text_problems(body)
            probs += q.latex_render_problems(body, o["frontend_dir"])
            img_probs, copied = q.image_problems(body, settings.MEDIA_ROOT, o["img_root"] or None,
                                                 copy=not o["dry_run"])
            probs += img_probs
            f_probs, f_copied = q.file_problems(body, settings.MEDIA_ROOT, o["img_root"] or None,
                                                copy=not o["dry_run"])  # r134
            probs += f_probs; copied += f_copied
            publish = bool(o["publish"]) and not probs
            status = "OK" if not probs else f"ПРОБЛЕМЫ ({len(probs)})"
            self.stdout.write(f"{p.name}: {exam}/{subject}/{number} «{title}» — {status}")
            for pr in probs:
                self.stdout.write(f"   - {pr}")
            for c in copied:
                self.stdout.write(f"   + скопирована картинка /media/{c}")
            if probs:
                bad += 1
            if o["dry_run"]:
                continue
            obj, created = Razbor.objects.update_or_create(
                exam=exam, subject=subject, number=number,
                defaults={"title": title, "content_md": q.rewrite_files(q.rewrite_images(body)), "source_file": p.name,
                          "published": publish})
            self.stdout.write(f"   {'создан' if created else 'обновлён'}, published={obj.published}, {obj.path}")
        self.stdout.write(f"RAZBOR_IMPORT files={len(files)} with_problems={bad}")
