"""r87: SEO — 404 для несуществующих страниц, 301 /gotovye-uroki, canonical/noindex, robots, sitemap, хабы /zadaniya."""
import json
import re
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, TestCase, override_settings

from Generator import seo
from Generator.models import Level, Subject, Task, TaskList

INDEX = ('<!doctype html><html><head><meta name="description" content="x" /><title>x</title></head>'
         '<body><div id="root"></div></body></html>')
_TMP = tempfile.mkdtemp()
(Path(_TMP) / "index.html").write_text(INDEX, encoding="utf-8")
H = {"HTTP_HOST": "itflux-academy.ru"}


@override_settings(FRONTEND_DIR=Path(_TMP), DEBUG=False)
class SeoR87Tests(TestCase):
    @classmethod
    def setUpTestData(cls):
        lv = Level.objects.create(level="ege", level_rus="ЕГЭ")
        Level.objects.create(level="oge", level_rus="ОГЭ")
        inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        chem = Subject.objects.create(subject_short="chem", subject_name="Химия")
        for subj in (inf, chem):
            for n in (1, 2, 3):
                tl = TaskList.objects.create(subject=subj, level=lv, task_number=n, task_title=f"Тема {n}", max_score=1, part=None)
                for i in range(3):
                    Task.objects.create(task=tl, task_template=f"<p>Условие задачи номер {n}-{i} достаточно длинное для примера</p>",
                                        is_active=True, scope="global")

    def get(self, path, **kw):
        return self.client.get(path, **{**H, **kw})

    # --- 404 ---
    def test_unknown_pages_404(self):
        for p in ("/nope-xyz", "/lessons/no-such-lesson/view", "/interesting/nope/view", "/ege/nosuch",
                  "/zadaniya/ege/inf/99", "/zadaniya/xxx", "/zadaniya/ege/nosuch", "/foo/bar/baz"):
            r = self.get(p)
            self.assertEqual(r.status_code, 404, p)
            if not p.startswith("/zadaniya/ege/inf/99"):
                self.assertIn("noindex", r.content.decode(), p)

    def test_http404_from_view_renders_spa_404(self):
        r = self.get("/zadaniya/ege/inf/99")
        self.assertEqual(r.status_code, 404)
        body = r.content.decode()
        self.assertIn("Страница не найдена", body)
        self.assertIn('<div id="root">', body)

    def test_real_app_routes_not_404(self):
        for p in ("/", "/pricing", "/lessons", "/interesting", "/tasks", "/subject", "/subject/ege", "/ege", "/ege/inf",
                  "/cabinet", "/cabinet/login", "/cabinet/students", "/cabinet/schedule", "/cabinet/boards/abc",
                  "/cabinet/student/assignments", "/cabinet/parent", "/cabinet/meetings/1234", "/login",
                  "/lesson/join", "/lesson/join/variant/5", "/teacher/boards/1", "/book/tok", "/invite/tok",
                  "/parent/invite/accept/tok", "/community/invite/tok", "/tasks/my", "/tasks/my/new", "/search/tasks",
                  "/search-variant", "/worksheets", "/teachers", "/repetitor", "/privacy", "/offer", "/contacts",
                  "/personal-data-consent", "/messages-agreement", "/for-teachers", "/generator", "/vpr", "/about",
                  "/ege/inf/variant/12", "/zadaniya", "/zadaniya/ege", "/zadaniya/ege/inf", "/zadaniya/ege/inf/2",
                  "/robots.txt", "/sitemap.xml"):
            self.assertEqual(self.get(p).status_code, 200, p)

    def test_api_404_stays_non_spa(self):
        r = self.get("/api/lessons/no-such-lesson-r87/")
        self.assertNotIn('<div id="root">', r.content.decode(errors="ignore"))

    # --- redirects / canonical ---
    def test_gotovye_uroki_301(self):
        for p, to in (("/gotovye-uroki", "/lessons"), ("/gotovye-uroki/", "/lessons"),
                      ("/gotovye-uroki?utm_source=x", "/lessons?utm_source=x")):
            r = self.get(p)
            self.assertEqual(r.status_code, 301, p)
            self.assertEqual(r["Location"], to)

    def test_canonical_without_params_and_preview_noindex(self):
        r = self.get("/lessons", data={"preview": "1"})
        b = r.content.decode()
        self.assertIn('<link rel="canonical" href="https://itflux-academy.ru/lessons" />', b)
        self.assertIn('name="robots" content="noindex', b)
        b = self.get("/lessons", data={"_itflux_v": "3"}).content.decode()
        self.assertIn('<link rel="canonical" href="https://itflux-academy.ru/lessons" />', b)
        self.assertNotIn('name="robots"', b)
        b = self.get("/interesting", data={"preview": "x"}).content.decode()
        self.assertIn('href="https://itflux-academy.ru/interesting"', b)
        self.assertIn("noindex", b)

    @override_settings(ALLOWED_HOSTS=["itflux-academy.ru", "cdn.itflux-academy.ru", "testserver"])
    def test_mirror_host(self):
        r = self.client.get("/pricing", HTTP_HOST="cdn.itflux-academy.ru")
        self.assertEqual(r.status_code, 200)
        self.assertIn('href="https://itflux-academy.ru/pricing"', r.content.decode())
        self.assertIn("noindex", r["X-Robots-Tag"])
        rb = self.client.get("/robots.txt", HTTP_HOST="cdn.itflux-academy.ru").content.decode()
        self.assertIn("Disallow: /\n", rb)
        self.assertNotIn("X-Robots-Tag", self.get("/pricing"))

    # --- robots / sitemap ---
    def test_robots(self):
        b = self.get("/robots.txt").content.decode()
        self.assertNotIn("Host:", b)
        self.assertIn("Clean-param: preview&_itflux_v", b)
        self.assertIn("Sitemap: https://itflux-academy.ru/sitemap.xml", b)

    def test_sitemap_focus_subjects_and_lastmod(self):
        b = self.get("/sitemap.xml").content.decode()
        self.assertIn("<loc>https://itflux-academy.ru/zadaniya</loc>", b)
        self.assertIn("/zadaniya/ege/inf/2</loc>", b)
        self.assertNotIn("/chem", b)
        self.assertNotIn("gotovye-uroki", b)
        self.assertRegex(b, r"/zadaniya/ege/inf/2</loc>\s*<lastmod>\d{4}-\d\d-\d\d</lastmod>")

    # --- /zadaniya ---
    def test_zadaniya_hub_links_and_jsonld(self):
        b = self.get("/zadaniya").content.decode()
        for n in (1, 2, 3):
            self.assertIn(f"href='/zadaniya/ege/inf/{n}'", b)
        self.assertNotIn("/zadaniya/ege/chem", b)
        lds = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', b, re.S)]
        types = {x["@type"] for x in lds}
        self.assertTrue({"BreadcrumbList", "FAQPage"} <= types)
        faq = next(x for x in lds if x["@type"] == "FAQPage")
        self.assertTrue(all(q["acceptedAnswer"]["text"] for q in faq["mainEntity"]))
        self.assertIn('<link rel="canonical" href="https://itflux-academy.ru/zadaniya">', b)

    def test_task_page_neighbours_and_short_title(self):
        b = self.get("/zadaniya/ege/inf/2").content.decode()
        self.assertIn("/zadaniya/ege/inf/1", b)
        self.assertIn("/zadaniya/ege/inf/3", b)
        self.assertIn("href=\"/zadaniya\"", b)
        t = re.search(r"<title>(.*?)</title>", b).group(1)
        self.assertLessEqual(len(t), 70)

    def test_short_title(self):
        t = seo.short_title("Решение задания 8 ЕГЭ по информатике: очень длинное название урока про перебор слов",
                            "урок", "ЕГЭ", "информатика")
        self.assertLessEqual(len(t), 70)
        self.assertEqual(t.count("ЕГЭ"), 1)
        self.assertTrue(t.endswith("| Цифровой поток"))
        self.assertEqual(seo.short_title("Пляж корней", "урок", "ОГЭ", "математика"),
                         "Пляж корней — урок ОГЭ математика | Цифровой поток")


class R100ServiceNoindexTests(SimpleTestCase):
    def test_robots_blocks_cabinet_without_slash(self):
        from .seo import robots_txt_body
        body = robots_txt_body()
        self.assertIn("Disallow: /cabinet\n", body)
        self.assertNotIn("Disallow: /cabinet/\n", body)

    def test_service_paths(self):
        from django.test import RequestFactory
        from .seo import _is_service_path
        rf = RequestFactory()
        for p in ("/cabinet", "/cabinet/login", "/api/interesting/", "/teacher/x"):
            self.assertTrue(_is_service_path(rf.get(p)), p)
        self.assertTrue(_is_service_path(rf.get("/lessons", {"preview": "1"})))
        for p in ("/", "/lessons", "/interesting", "/zadaniya/oge", "/cabinetry"):
            self.assertFalse(_is_service_path(rf.get(p)), p)
