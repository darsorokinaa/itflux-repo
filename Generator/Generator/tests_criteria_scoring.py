"""Тесты многоосевых критериев (говорение ЕГЭ)."""

from django.contrib.auth.models import User
from django.test import Client, TestCase

from Generator.criteria_scoring import build_criteria_payload, compute_axes_task_score
from Generator.models import Criteria, Level, Part, Subject, TaskList


class CriteriaScoringUnitTests(TestCase):
    def test_build_payload_single_mode(self):
        payload = build_criteria_payload(
            [
                {"id": 1, "criteria_text": "ok", "criteria_score": 2, "axis_code": ""},
                {"id": 2, "criteria_text": "no", "criteria_score": 0, "axis_code": ""},
            ],
            max_score=2,
        )
        self.assertEqual(payload["scoring_mode"], "single")
        self.assertEqual(payload["axes"], [])
        self.assertEqual(len(payload["criteria"]), 2)

    def test_build_payload_axes_mode(self):
        payload = build_criteria_payload(
            [
                {
                    "id": 1,
                    "criteria_text": "full",
                    "criteria_score": 4,
                    "axis_code": "content",
                    "axis_title": "Содержание",
                    "axis_order": 1,
                    "axis_max": 4,
                    "is_gate": False,
                },
                {
                    "id": 2,
                    "criteria_text": "zero",
                    "criteria_score": 0,
                    "axis_code": "content",
                    "axis_title": "Содержание",
                    "axis_order": 1,
                    "axis_max": 4,
                    "is_gate": False,
                },
                {
                    "id": 3,
                    "criteria_text": "org3",
                    "criteria_score": 3,
                    "axis_code": "organization",
                    "axis_title": "Организация",
                    "axis_order": 2,
                    "axis_max": 3,
                    "is_gate": False,
                },
            ],
            max_score=10,
        )
        self.assertEqual(payload["scoring_mode"], "axes")
        self.assertEqual(len(payload["axes"]), 2)
        self.assertEqual(payload["axes"][0]["code"], "content")
        self.assertFalse(payload["axes"][0]["is_gate"])
        self.assertEqual(payload["axes"][0]["max_score"], 4)

    def test_sum_when_content_zero(self):
        axes = [
            {"code": "content", "max_score": 4},
            {"code": "organization", "max_score": 3},
            {"code": "language", "max_score": 3},
        ]
        result = compute_axes_task_score(
            axes,
            {"content": 0, "organization": 3, "language": 3},
        )
        self.assertFalse(result["gated"])
        self.assertEqual(result["total"], 6)
        self.assertTrue(result["complete"])

    def test_sum_binary_axes(self):
        axes = [
            {"code": "q1", "max_score": 1},
            {"code": "q2", "max_score": 1},
            {"code": "q3", "max_score": 1},
            {"code": "q4", "max_score": 1},
        ]
        result = compute_axes_task_score(axes, {"q1": 1, "q2": 1, "q3": 0, "q4": 1})
        self.assertEqual(result["total"], 3)
        self.assertFalse(result["gated"])


class CriteriaApiAxesTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.subject = Subject.objects.create(
            subject_short="eng_speaking",
            subject_name="Английский язык (устная часть)",
        )
        self.level = Level.objects.create(level="ege", level_rus="ЕГЭ")
        self.part = Part.objects.create(part_title="Говорение")
        self.tl = TaskList.objects.create(
            subject=self.subject,
            level=self.level,
            part=self.part,
            task_number=4,
            task_title="Проект",
            max_score=10,
        )
        Criteria.objects.create(
            task_number=self.tl,
            criteria_text="<p>content 4</p>",
            criteria_score=4,
            axis_code="content",
            axis_title="Содержание",
            axis_order=1,
            axis_max=4,
            is_gate=False,
        )
        Criteria.objects.create(
            task_number=self.tl,
            criteria_text="<p>content 0</p>",
            criteria_score=0,
            axis_code="content",
            axis_title="Содержание",
            axis_order=1,
            axis_max=4,
            is_gate=False,
        )
        Criteria.objects.create(
            task_number=self.tl,
            criteria_text="<p>org 3</p>",
            criteria_score=3,
            axis_code="organization",
            axis_title="Организация",
            axis_order=2,
            axis_max=3,
            is_gate=False,
        )

    def test_api_returns_axes_mode(self):
        url = f"/api/ege/eng_speaking/criteria/?task_list_id={self.tl.id}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["scoring_mode"], "axes")
        self.assertEqual(data["max_score"], 10)
        codes = [a["code"] for a in data["axes"]]
        self.assertEqual(codes, ["content", "organization"])
        content = data["axes"][0]
        self.assertFalse(content["is_gate"])
        self.assertEqual(content["max_score"], 4)
        self.assertGreaterEqual(len(content["levels"]), 2)
