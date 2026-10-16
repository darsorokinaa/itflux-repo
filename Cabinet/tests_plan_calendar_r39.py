from types import SimpleNamespace as NS

from django.test import SimpleTestCase

from Cabinet.plan_schedule import linked_schedule_event_for_item


class LinkedEventIgnoresInactiveTests(SimpleTestCase):
    """r39: план не должен показывать время отменённого занятия, которого нет в календаре."""

    def _item(self, event, linked=()):
        return NS(id=7, scheduled_event=event, scheduled_event_id=getattr(event, "id", None),
                  schedule_events_linked=list(linked))

    def test_active_event_is_used(self):
        ev = NS(id=1, lesson_plan_item_id=7, status="planned")
        self.assertIs(linked_schedule_event_for_item(self._item(ev)), ev)

    def test_cancelled_event_is_ignored(self):
        ev = NS(id=1, lesson_plan_item_id=7, status="cancelled")
        self.assertIsNone(linked_schedule_event_for_item(self._item(ev, [ev])))

    def test_falls_back_to_active_linked_event(self):
        cancelled = NS(id=1, lesson_plan_item_id=7, status="cancelled")
        active = NS(id=2, lesson_plan_item_id=7, status="moved")
        self.assertIs(linked_schedule_event_for_item(self._item(cancelled, [cancelled, active])), active)
