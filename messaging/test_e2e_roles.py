"""Роли через живой Daphne: HTTP и WebSocket, не только APIClient."""

import base64
import os
import socket
from urllib.parse import urlparse

import requests
from channels.testing.live import ChannelsLiveServerTestCase
from django.middleware.csrf import _get_new_csrf_string, _mask_cipher_secret
from django.test import Client

from messaging.live_daphne import TestDatabaseDaphneProcess

from Cabinet.models import Profile, Student
from messaging.tests import PNG, make_user


def _ws_status(http_url: str, sessionid: str) -> int:
    parsed = urlparse(http_url)
    sock = socket.create_connection((parsed.hostname, parsed.port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    host = f"{parsed.hostname}:{parsed.port}"
    payload = (
        "GET /ws/messaging/ HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        f"Cookie: sessionid={sessionid}\r\n"
        "\r\n"
    )
    try:
        sock.sendall(payload.encode())
        data = b""
        while b"\r\n" not in data:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        line = data.split(b"\r\n", 1)[0].decode("latin1", "replace")
        parts = line.split()
        return int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    finally:
        sock.close()


class MessagingLiveRoleTests(ChannelsLiveServerTestCase):
    ProtocolServerProcess = TestDatabaseDaphneProcess

    @classmethod
    def setUpClass(cls):
        from django.db import connection

        os.environ["MESSAGING_E2E_TEST_DB"] = connection.settings_dict["NAME"]
        super().setUpClass()
    def setUp(self):
        self.superuser = make_user("e2e_super", Profile.Role.TEACHER)
        self.superuser.is_superuser = True
        self.superuser.is_staff = True
        self.superuser.save(update_fields=["is_superuser", "is_staff"])
        self.staff = make_user("e2e_staff", Profile.Role.TEACHER)
        self.staff.is_staff = True
        self.staff.save(update_fields=["is_staff"])
        self.teacher_a = make_user("e2e_teacher_a", Profile.Role.TEACHER)
        self.teacher_b = make_user("e2e_teacher_b", Profile.Role.TEACHER)
        self.student_a = make_user("e2e_student_a", Profile.Role.STUDENT)
        self.student_b = make_user("e2e_student_b", Profile.Role.STUDENT)
        Student.objects.create(teacher=self.teacher_a, user=self.student_a, first_name="Аня", last_name="А", grade=8)
        Student.objects.create(teacher=self.teacher_b, user=self.student_b, first_name="Боря", last_name="Б", grade=9)

    def _session(self, user):
        client = Client()
        self.assertTrue(client.login(username=user.username, password="pass12345"))
        session = requests.Session()
        key = client.cookies["sessionid"].value
        token = _mask_cipher_secret(_get_new_csrf_string())
        session.headers["Cookie"] = f"sessionid={key}; csrftoken={token}"
        session.headers["X-CSRFToken"] = token
        session.headers["Referer"] = self.live_server_url + "/"
        probe = session.get(f"{self.live_server_url}/api/cabinet/me/", timeout=10)
        self.assertEqual(probe.status_code, 200, probe.text)
        self.assertTrue(probe.json().get("authenticated"), probe.text)
        session.user_session = client.cookies["sessionid"].value
        return session

    def _post(self, session, path, payload=None, files=None):
        return session.post(
            f"{self.live_server_url}{path}",
            json=None if files else payload,
            data=None if not files else payload,
            files=files,
            timeout=15,
        )

    def test_roles_through_live_server(self):
        teacher = self._session(self.teacher_a)
        pupil = self._session(self.student_a)
        other_teacher = self._session(self.teacher_b)
        other_pupil = self._session(self.student_b)
        staff = self._session(self.staff)
        admin = self._session(self.superuser)

        opened = self._post(teacher, "/api/cabinet/messages/conversations/direct/", {"user_id": self.student_a.id})
        self.assertEqual(opened.status_code, 200, opened.text)
        conversation_id = opened.json()["conversation"]["id"]
        sent = self._post(teacher, f"/api/cabinet/messages/conversations/{conversation_id}/messages/", {"text": "Урок в четверг"})
        self.assertEqual(sent.status_code, 201, sent.text)
        message_id = sent.json()["message"]["id"]

        hidden = other_teacher.get(f"{self.live_server_url}/api/cabinet/messages/conversations/{conversation_id}/messages/", timeout=10)
        self.assertEqual(hidden.status_code, 404)
        staff_hidden = staff.get(f"{self.live_server_url}/api/cabinet/messages/conversations/{conversation_id}/messages/", timeout=10)
        self.assertEqual(staff_hidden.status_code, 404)

        peer = self._post(other_pupil, "/api/cabinet/messages/conversations/direct/", {"user_id": self.student_a.id})
        self.assertEqual(peer.status_code, 404)
        foreign = self._post(teacher, "/api/cabinet/messages/conversations/direct/", {"user_id": self.student_b.id})
        self.assertEqual(foreign.status_code, 404)

        colleagues = self._post(teacher, "/api/cabinet/messages/conversations/direct/", {"user_id": self.teacher_b.id})
        self.assertEqual(colleagues.status_code, 200, colleagues.text)
        colleague_id = colleagues.json()["conversation"]["id"]
        colleague_message = self._post(other_teacher, f"/api/cabinet/messages/conversations/{colleague_id}/messages/", {"text": "Обменяемся материалом"})
        self.assertEqual(colleague_message.status_code, 201, colleague_message.text)

        ticket = self._post(teacher, "/api/cabinet/messages/support/tickets/", {"category": "technical", "subject": "Микрофон", "text": "На уроке тишина"})
        self.assertEqual(ticket.status_code, 201, ticket.text)
        kinds = {row["type"] for row in teacher.get(f"{self.live_server_url}/api/cabinet/messages/conversations/", timeout=10).json()["conversations"]}
        self.assertIn("support", kinds)
        self.assertIn("developer", kinds)

        created = self._post(admin, "/api/cabinet/messages/communities/", {"name": "Алгебра", "subject": "Алгебра", "description": "Закрытый чат"})
        self.assertEqual(created.status_code, 201, created.text)
        community_id = created.json()["conversation_id"]
        invite = self._post(admin, f"/api/cabinet/messages/conversations/{community_id}/invites/", {"user_id": self.teacher_a.id})
        self.assertEqual(invite.status_code, 201, invite.text)
        accepted = self._post(teacher, "/api/cabinet/messages/community-invites/accept/", {"invite_id": invite.json()["id"]})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        posted = self._post(teacher, f"/api/cabinet/messages/conversations/{community_id}/messages/", {"text": "Первое сообщение сообщества"})
        self.assertEqual(posted.status_code, 201, posted.text)
        removed = self._post(admin, f"/api/cabinet/messages/conversations/{community_id}/members/{self.teacher_a.id}/", {"action": "remove"})
        self.assertEqual(removed.status_code, 200, removed.text)
        after_remove = teacher.get(f"{self.live_server_url}/api/cabinet/messages/conversations/{community_id}/messages/", timeout=10)
        self.assertEqual(after_remove.status_code, 404)
        invite_again = self._post(admin, f"/api/cabinet/messages/conversations/{community_id}/invites/", {"user_id": self.teacher_b.id})
        self.assertEqual(invite_again.status_code, 201, invite_again.text)
        self._post(other_teacher, "/api/cabinet/messages/community-invites/accept/", {"invite_id": invite_again.json()["id"]})
        banned = self._post(admin, f"/api/cabinet/messages/conversations/{community_id}/members/{self.teacher_b.id}/", {"action": "ban"})
        self.assertEqual(banned.status_code, 200, banned.text)
        rejoin = self._post(admin, f"/api/cabinet/messages/conversations/{community_id}/invites/", {"user_id": self.teacher_b.id})
        self.assertEqual(rejoin.status_code, 201, rejoin.text)
        denied = self._post(other_teacher, "/api/cabinet/messages/community-invites/accept/", {"invite_id": rejoin.json()["id"]})
        self.assertEqual(denied.status_code, 404)

        upload = self._post(
            teacher,
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Скан тетради"},
            files={"files": ("note.png", PNG, "image/png")},
        )
        self.assertEqual(upload.status_code, 201, upload.text)
        attachment_id = upload.json()["message"]["attachments"][0]["id"]
        download = pupil.get(f"{self.live_server_url}/api/cabinet/messages/attachments/{attachment_id}/", timeout=10)
        self.assertEqual(download.status_code, 200)
        stranger_file = other_pupil.get(f"{self.live_server_url}/api/cabinet/messages/attachments/{attachment_id}/", timeout=10)
        self.assertEqual(stranger_file.status_code, 404)

        reply = self._post(pupil, f"/api/cabinet/messages/conversations/{conversation_id}/messages/", {"text": "Поняла", "reply_to": message_id})
        self.assertEqual(reply.status_code, 201, reply.text)
        self.assertEqual(reply.json()["message"]["reply_to"]["excerpt"], "Урок в четверг")
        edited = pupil.patch(
            f"{self.live_server_url}/api/cabinet/messages/conversations/{conversation_id}/messages/{reply.json()['message']['id']}/",
            json={"text": "Поняла, спасибо"},
            timeout=10,
        )
        self.assertEqual(edited.status_code, 200, edited.text)

        read = self._post(pupil, f"/api/cabinet/messages/conversations/{conversation_id}/read/", {"message_id": message_id})
        delivered = self._post(pupil, f"/api/cabinet/messages/conversations/{conversation_id}/delivered/", {"message_id": message_id})
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(delivered.status_code, 200, delivered.text)
        unread = teacher.get(f"{self.live_server_url}/api/cabinet/messages/unread-count/", timeout=10)
        self.assertEqual(unread.status_code, 200)
        self.assertGreaterEqual(unread.json()["unread_count"], 1)

        self.assertEqual(_ws_status(self.live_server_url, teacher.user_session), 101)
        logged_out = teacher.post(f"{self.live_server_url}/api/cabinet/logout/", timeout=10)
        self.assertEqual(logged_out.status_code, 200, logged_out.text)
        self.assertNotEqual(_ws_status(self.live_server_url, teacher.user_session), 101)

        Student.objects.filter(teacher=self.teacher_a, user=self.student_a).update(status="archived")
        history = pupil.get(f"{self.live_server_url}/api/cabinet/messages/conversations/{conversation_id}/messages/", timeout=10)
        self.assertEqual(history.status_code, 200)
        self.assertIn("Урок в четверг", history.text)
        blocked = self._post(pupil, f"/api/cabinet/messages/conversations/{conversation_id}/messages/", {"text": "После архива"})
        self.assertEqual(blocked.status_code, 400)
