from types import SimpleNamespace

from django.test import SimpleTestCase

from Generator.variant_instructions import exam_part_key, instructions_from_previews, preview_plain_text


class VariantInstructionTests(SimpleTestCase):
    def test_plain_text_drops_markup(self):
        self.assertEqual(
            preview_plain_text("<p>Часть&nbsp;1<br>Ответ — число.</p>"),
            "Часть 1 Ответ — число.",
        )

    def test_part_titles_map_to_template_parts(self):
        self.assertEqual(exam_part_key(SimpleNamespace(part_title="Часть 1")), "1")
        self.assertEqual(exam_part_key(SimpleNamespace(part_title="Часть 2")), "2")
        self.assertEqual(exam_part_key(SimpleNamespace(part_title="Часть 3")), "2")
        self.assertEqual(exam_part_key(SimpleNamespace(part_title="Говорение")), "2")
        self.assertIsNone(exam_part_key(None))

    def test_previews_split_cover_and_parts_and_skip_reminders(self):
        instruction = SimpleNamespace(preview_type_text="Инструкция")
        reminder = SimpleNamespace(preview_type_text="Напоминание")
        previews = [
            SimpleNamespace(
                task_preview_text="<p>Прочитайте работу до конца.</p>",
                preview_type=instruction,
                part=None,
                part_id=None,
            ),
            SimpleNamespace(
                task_preview_text="<p>Краткий ответ.</p>",
                preview_type=instruction,
                part=SimpleNamespace(part_title="Часть 1"),
                part_id=1,
            ),
            SimpleNamespace(
                task_preview_text="<p>Это напоминание.</p>",
                preview_type=reminder,
                part=SimpleNamespace(part_title="Часть 2"),
                part_id=2,
            ),
            SimpleNamespace(
                task_preview_text="<p>Устный ответ.</p>",
                preview_type=None,
                part=SimpleNamespace(part_title="Говорение"),
                part_id=4,
            ),
        ]
        result = instructions_from_previews(previews)
        self.assertEqual(result["cover_paragraphs"], ["Прочитайте работу до конца."])
        self.assertEqual(result["part_instructions"]["1"], "Краткий ответ.")
        self.assertEqual(result["part_instructions"]["2"], "Устный ответ.")
        self.assertNotIn("Это напоминание.", result["part_instructions"]["2"])
