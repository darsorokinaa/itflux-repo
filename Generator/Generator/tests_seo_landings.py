"""SEO-лендинги: индексируемая вёрстка, примеры без ответов, лимит гостевого демо."""

import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings

from Generator.models import (
    InterestingItem,
    Lesson,
    Level,
    Subject,
    Task,
    TaskList,
    Variant,
)
from Generator.seo_landings import MATERIALS_LIMIT, PAGES, SAMPLE_LIMIT

INDEX = (
    '<!doctype html><html><head><meta name="description" content="x" /><title>x</title></head>'
    '<body><div id="root"></div></body></html>'
)
_TMP = Path(tempfile.mkdtemp())
(_TMP / "index.html").write_text(INDEX, encoding="utf-8")
(_TMP / "media").mkdir(exist_ok=True)
HOST = {"HTTP_HOST": "itflux-academy.ru"}
SECRET_ANSWER = "SECRET-ANSWER-9f3a"
SECRET_SOLUTION = "SECRET-SOLUTION-9f3a"
TEACHER_MARK = "TEACHER-ONLY-TASK"
EVIL_SRC = "https://evil.example/secret.png"
FOURTH = "ЧЕТВЕРТОЕ задание не входит в стабильные три примера"
INACTIVE = "НЕАКТИВНАЯ задача не должна попасть"
PRIVATE_LESSON = "Закрытый урок математики для одного учителя"
PAID_TRAINER = "Закрытый тренажёр ЕГЭ по информатике"
TASK8_TITLE = "Тренажёр: задание №8 ЕГЭ по информатике"


def _long(text):
    return (
        f"<p>{text} Условие достаточно длинное для примера на публичной странице.</p>"
    )


@override_settings(
    FRONTEND_DIR=_TMP,
    MEDIA_ROOT=_TMP / "media",
    DEBUG=False,
    ALLOWED_HOSTS=["itflux-academy.ru", "testserver", "localhost"],
)
class SeoLandingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        ege = Level.objects.create(level="ege", level_rus="ЕГЭ")
        oge = Level.objects.create(level="oge", level_rus="ОГЭ")
        inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        math = Subject.objects.create(subject_short="math", subject_name="Математика")
        Subject.objects.create(subject_short="chem", subject_name="Химия")

        def tasklist(subject, level, number, title):
            return TaskList.objects.create(
                subject=subject,
                level=level,
                task_number=number,
                task_title=title,
                max_score=1,
                part=None,
            )

        lists = {
            1: tasklist(inf, ege, 1, "Анализ данных"),
            2: tasklist(inf, ege, 2, "Логика"),
            3: tasklist(inf, ege, 3, "Кодирование"),
            4: tasklist(inf, ege, 4, "Коды"),
            5: tasklist(inf, ege, 5, "Скрытое"),
        }
        Task.objects.create(
            task=lists[1],
            task_template=_long("Открытое условие ЕГЭ по информатике номер один"),
            is_active=True,
            scope="global",
            answer=SECRET_ANSWER,
            solution=SECRET_SOLUTION,
        )
        teacher = get_user_model().objects.create_user("seo-landing-teacher")
        Task.objects.create(
            task=lists[1],
            task_template=_long(TEACHER_MARK),
            is_active=True,
            scope="teacher",
            owner_teacher=teacher,
            local_number=1,
            answer="TEACHER-SECRET-ANSWER",
        )
        Task.objects.create(
            task=lists[2],
            task_template=_long("Длинное условие со внешней картинкой")
            + f'<img src="{EVIL_SRC}">',
            is_active=True,
            scope="global",
        )
        Task.objects.create(
            task=lists[2],
            task_template=_long("Запасное условие задания два без внешней картинки"),
            is_active=True,
            scope="global",
        )
        Task.objects.create(
            task=lists[3],
            task_template=_long("Открытое условие ЕГЭ по информатике номер три"),
            is_active=True,
            scope="global",
        )
        Task.objects.create(
            task=lists[4],
            task_template=_long(FOURTH),
            is_active=True,
            scope="global",
        )
        Task.objects.create(
            task=lists[5],
            task_template=_long(INACTIVE),
            is_active=False,
            scope="global",
        )
        for number, title in ((6, "Вычисления"), (7, "Графики"), (8, "Геометрия")):
            row = tasklist(math, oge, number, title)
            Task.objects.create(
                task=row,
                task_template=_long(
                    f"Открытое условие ОГЭ по математике номер {number}"
                ),
                is_active=True,
                scope="global",
                answer=SECRET_ANSWER,
                solution=SECRET_SOLUTION,
            )

        Lesson.objects.create(
            title="Практико-ориентированные задачи",
            slug="seo-math-1",
            subject="Математика",
            exam_type="oge",
            task_number=1,
            topic="Практические задачи",
            short_description="Карточка урока по заданиям 1–5 ОГЭ, без файла для гостя.",
            status=Lesson.Status.PUBLISHED,
            access_level=Lesson.AccessLevel.FREE,
        )
        Lesson.objects.create(
            title="Фигуры на клетчатой бумаге",
            slug="seo-math-18",
            subject="Математика",
            exam_type="oge",
            task_number=18,
            topic="Клетка",
            short_description="Карточка урока по заданию 18 ОГЭ по математике.",
            status=Lesson.Status.PUBLISHED,
            access_level=Lesson.AccessLevel.FREE,
        )
        Lesson.objects.create(
            title="Геометрические высказывания",
            slug="seo-math-19",
            subject="Математика",
            exam_type="oge",
            task_number=19,
            topic="Высказывания",
            short_description="Карточка урока по заданию 19 ОГЭ по математике.",
            status=Lesson.Status.PUBLISHED,
            access_level=Lesson.AccessLevel.FREE,
        )
        Lesson.objects.create(
            title="Платный урок прогрессии",
            slug="seo-math-paid",
            subject="Математика",
            exam_type="oge",
            task_number=5,
            short_description="Этот урок требует тариф и не заменяет бесплатные карточки.",
            status=Lesson.Status.PUBLISHED,
            access_level=Lesson.AccessLevel.PROFESSIONAL,
        )
        Lesson.objects.create(
            title=PRIVATE_LESSON,
            slug="seo-math-private",
            subject="Математика",
            exam_type="oge",
            task_number=2,
            status=Lesson.Status.PUBLISHED,
            access_level=Lesson.AccessLevel.PRIVATE,
        )
        Lesson.objects.create(
            title="Урок химии",
            slug="seo-chem",
            subject="Химия",
            exam_type="oge",
            task_number=1,
            status=Lesson.Status.PUBLISHED,
            access_level=Lesson.AccessLevel.FREE,
        )

        def trainer(title, slug, access, status, with_file=True):
            item = InterestingItem.objects.create(
                title=title,
                slug=slug,
                short_description=f"Краткое описание: {title}",
                status=status,
                access_level=access,
            )
            if with_file:
                item.file.save(
                    "index.html", ContentFile("<p>Тренажёр</p>".encode()), save=True
                )
            return item

        trainer(
            TASK8_TITLE,
            "seo-inf-8",
            InterestingItem.AccessLevel.FREE,
            InterestingItem.Status.PUBLISHED,
        )
        trainer(
            "История развития информатики",
            "seo-inf-history",
            InterestingItem.AccessLevel.FREE,
            InterestingItem.Status.PUBLISHED,
        )
        trainer(
            "Тренажёр ЕГЭ по информатике, №15",
            "seo-inf-15",
            InterestingItem.AccessLevel.FREE,
            InterestingItem.Status.PUBLISHED,
        )
        trainer(
            PAID_TRAINER,
            "seo-inf-paid",
            InterestingItem.AccessLevel.TEACHER,
            InterestingItem.Status.PUBLISHED,
        )
        trainer(
            "Черновик тренажёра по информатике",
            "seo-inf-draft",
            InterestingItem.AccessLevel.FREE,
            InterestingItem.Status.DRAFT,
        )
        trainer(
            "Тренажёр по уравнениям",
            "seo-math-trainer",
            InterestingItem.AccessLevel.FREE,
            InterestingItem.Status.PUBLISHED,
        )
        trainer(
            "Информатика без файла",
            "seo-inf-nofile",
            InterestingItem.AccessLevel.FREE,
            InterestingItem.Status.PUBLISHED,
            with_file=False,
        )

    def setUp(self):
        cache.clear()

    def get(self, path):
        return self.client.get(path, **HOST)

    def test_pages_are_indexable(self):
        seen_titles = set()
        for page in PAGES:
            self.assertLessEqual(len(page["title"]), 70, page["slug"])
            self.assertNotIn(page["title"], seen_titles)
            seen_titles.add(page["title"])
            response = self.get(page["path"])
            body = response.content.decode()
            self.assertEqual(response.status_code, 200, page["path"])
            self.assertIn(f"<title>{page['title']}</title>", body)
            self.assertIn(page["description"], body)
            self.assertIn(
                f'<h1 style="font-size:28px;margin:0 0 12px">{page["h1"]}</h1>', body
            )
            canonical = f"https://itflux-academy.ru{page['path']}"
            self.assertIn(f'<link rel="canonical" href="{canonical}" />', body)
            self.assertIn("Зарегистрироваться", body)
            self.assertIn(f"utm_campaign={page['slug']}", body)
            self.assertIn("utm_source=seo", body)
            self.assertIn("utm_medium=landing", body)
            self.assertIn(
                f'<h1 style="font-size:28px;margin:0 0 12px">{page["h1"]}</h1><p style="font-size:16px;margin:0 0 12px">{page["description"]}</p>',
                body,
            )
            self.assertIn(" — Цифровой поток", page["title"])
            self.assertNotIn("открытый банк", body)
            self.assertNotIn("25 000", body)
            self.assertNotIn("25000", body)
            self.assertNotIn(SECRET_ANSWER, body)
            self.assertNotIn(SECRET_SOLUTION, body)
            self.assertNotIn(TEACHER_MARK, body)
            self.assertNotIn(EVIL_SRC, body)
            self.assertNotIn(PRIVATE_LESSON, body)

        sitemap = self.get("/sitemap.xml").content.decode()
        for page in PAGES:
            self.assertIn(
                f"<loc>https://itflux-academy.ru{page['path']}</loc>", sitemap
            )

    def test_examples_skip_private_answers_and_files(self):
        ege = self.get("/api/seo/landing/generator-variantov-ege-informatika/").json()
        numbers = [item["task_number"] for item in ege["materials"]]
        self.assertEqual(numbers, [1, 2, 3])
        blob = str(ege)
        self.assertIn("Запасное условие задания два", blob)
        self.assertNotIn(SECRET_ANSWER, blob)
        self.assertNotIn(SECRET_SOLUTION, blob)
        self.assertNotIn(TEACHER_MARK, blob)
        self.assertNotIn(EVIL_SRC, blob)
        self.assertNotIn(FOURTH, blob)
        self.assertNotIn(INACTIVE, blob)
        for item in ege["materials"]:
            self.assertNotIn("answer", item)
            self.assertNotIn("solution", item)
            self.assertNotIn("file_url", item)

        lessons = self.get("/api/seo/landing/gotovye-uroki-po-matematike/").json()
        titles = [item["title"] for item in lessons["materials"]]
        self.assertEqual(
            titles,
            [
                "Практико-ориентированные задачи",
                "Фигуры на клетчатой бумаге",
                "Геометрические высказывания",
            ],
        )
        self.assertNotIn("file_url", str(lessons["materials"]))
        self.assertNotIn("Платный урок прогрессии", str(lessons))
        self.assertNotIn(PRIVATE_LESSON, str(lessons))
        self.assertNotIn("Урок химии", str(lessons))

        interactive = self.get(
            "/api/seo/landing/interaktivnye-zadaniya-oge-ege-informatika/"
        ).json()
        self.assertEqual(interactive["play"]["slug"], "seo-inf-8")
        slugs = [item["slug"] for item in interactive["materials"]]
        self.assertEqual(slugs[0], "seo-inf-8")
        self.assertNotIn("seo-inf-history", slugs)
        self.assertNotIn("seo-inf-paid", slugs)
        self.assertIn(
            "задание №15", " ".join(item["title"] for item in interactive["materials"])
        )
        self.assertNotIn("seo-inf-draft", slugs)
        self.assertNotIn("seo-math-trainer", slugs)
        self.assertNotIn("seo-inf-nofile", slugs)
        self.assertNotIn(PAID_TRAINER, str(interactive))

    def test_sample_does_not_persist_variant_and_is_rate_limited(self):
        before = Variant.objects.count()
        first = self.get("/api/seo/landing/generator-variantov-ege-informatika/sample/")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(Variant.objects.count(), before)
        self.assertNotIn(SECRET_ANSWER, first.content.decode())
        self.assertEqual(first["Cache-Control"], "no-store")
        self.assertEqual(
            self.get(
                "/api/seo/landing/gotovye-uroki-po-matematike/sample/"
            ).status_code,
            404,
        )
        self.assertEqual(self.get("/api/seo/landing/missing-slug/").status_code, 404)

        cache.clear()
        statuses = [
            self.get(
                "/api/seo/landing/generator-variantov-oge-matematika/sample/"
            ).status_code
            for _ in range(SAMPLE_LIMIT + 1)
        ]
        self.assertEqual(statuses[:SAMPLE_LIMIT], [200] * SAMPLE_LIMIT)
        self.assertEqual(statuses[-1], 429)
        self.assertLess(MATERIALS_LIMIT, 100)

    def test_paid_lessons_are_not_shown_when_nothing_is_free(self):
        Lesson.objects.filter(subject="Математика").update(
            access_level=Lesson.AccessLevel.PROFESSIONAL
        )
        cache.clear()
        payload = self.get("/api/seo/landing/gotovye-uroki-po-matematike/").json()
        self.assertEqual(payload["materials"], [])
        self.assertIn("если урок в каталоге бесплатный", payload["description"])

    def test_unknown_path_stays_404(self):
        response = self.get("/nope-seo-landing")
        self.assertEqual(response.status_code, 404)
