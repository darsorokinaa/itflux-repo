"""Повторяемый стенд видеосвязи.

Поднимает только локальные процессы на 127.0.0.1 и базу itflux_video_e2e.
Рабочие порты 8000 и 5001 и база itflux не используются.
"""

import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAND = Path(__file__).resolve().parent
RUN = STAND / ".run"
E2E_DB = "itflux_video_e2e"
PYTHON = ROOT / ".venv" / "bin" / "python"
if not PYTHON.exists():
    PYTHON = Path(sys.executable)

PORTS = {
    "django": 8011,
    "vite": 5011,
    "livekit": 7880,
    "livekit_tcp": 7881,
    "tls": 7883,
}


def port_busy(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def assert_ports_free():
    busy = [port for port in PORTS.values() if port_busy(port)]
    if busy:
        raise SystemExit(f"test ports already in use: {busy}")


def load_db_params():
    os.environ["DJANGO_SETTINGS_MODULE"] = "stand_settings"
    sys.path[:0] = [str(STAND), str(ROOT)]
    import stand_settings as settings

    params = settings.DATABASES["default"]
    if params["NAME"] != E2E_DB:
        raise SystemExit(f"refusing database {params['NAME']}")
    return {
        "user": params.get("USER") or "",
        "password": params.get("PASSWORD") or "",
        "host": params.get("HOST") or "localhost",
        "port": params.get("PORT") or 5432,
    }


def connect(params, dbname):
    import psycopg2

    return psycopg2.connect(
        dbname=dbname,
        user=params["user"] or None,
        password=params["password"] or None,
        host=params["host"],
        port=params["port"],
    )


def ensure_database(params):
    admin = connect(params, "postgres")
    admin.autocommit = True
    with admin.cursor() as cursor:
        cursor.execute("SELECT current_database()")
        current = cursor.fetchone()[0]
        if current != "postgres":
            raise SystemExit(f"refusing admin database {current}")
        cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (E2E_DB,))
        exists = cursor.fetchone() is not None
        if not exists:
            cursor.execute(f'CREATE DATABASE "{E2E_DB}"')
    admin.close()
    probe = connect(params, E2E_DB)
    probe.autocommit = True
    with probe.cursor() as cursor:
        cursor.execute("SELECT current_database()")
        current = cursor.fetchone()[0]
        if current != E2E_DB:
            raise SystemExit(f"refusing connected database {current}")
        cursor.execute(
            "SELECT to_regclass('public.auth_user') IS NOT NULL"
        )
        has_users = cursor.fetchone()[0]
        foreign = 0
        if has_users:
            cursor.execute(
                "SELECT COUNT(*) FROM auth_user WHERE username NOT IN (%s, %s)",
                ("video-e2e-teacher", "video-e2e-student"),
            )
            foreign = cursor.fetchone()[0]
    probe.close()
    if foreign:
        raise SystemExit(f"database {E2E_DB} has {foreign} unexpected users; aborting")
    return {"created": not exists, "foreignUsers": foreign}


def ensure_secrets():
    RUN.mkdir(parents=True, exist_ok=True)
    cred_path = RUN / "credentials.json"
    if cred_path.exists():
        creds = json.loads(cred_path.read_text(encoding="utf-8"))
    else:
        creds = {
            "password": secrets.token_urlsafe(24),
            "livekitKey": "e2e" + secrets.token_hex(8),
            "livekitSecret": secrets.token_urlsafe(48),
        }
        cred_path.write_text(json.dumps(creds), encoding="utf-8")
        os.chmod(cred_path, 0o600)
    if len(creds["livekitSecret"]) < 32:
        raise SystemExit("livekit secret is too short")
    cert = RUN / "cert.pem"
    key = RUN / "key.pem"
    if not cert.exists() or not key.exists():
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", str(key), "-out", str(cert),
                "-days", "2", "-nodes",
                "-subj", "/CN=127.0.0.1",
                "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        os.chmod(key, 0o600)
    yaml_path = RUN / "livekit.yaml"
    yaml_path.write_text(
        "\n".join([
            "port: 7880",
            "bind_addresses:",
            '  - "127.0.0.1"',
            "rtc:",
            "  tcp_port: 7881",
            "  port_range_start: 51000",
            "  port_range_end: 51020",
            "  use_external_ip: false",
            "  node_ip: 127.0.0.1",
            "keys:",
            f'  "{creds["livekitKey"]}": "{creds["livekitSecret"]}"',
            "logging:",
            "  level: warn",
            "",
        ]),
        encoding="utf-8",
    )
    os.chmod(yaml_path, 0o600)
    return creds


def stand_env(creds):
    env = os.environ.copy()
    env["DJANGO_SETTINGS_MODULE"] = "stand_settings"
    env["PYTHONPATH"] = str(STAND)
    env["PYTHONUNBUFFERED"] = "1"
    env["LIVEKIT_URL"] = "wss://127.0.0.1:7883"
    env["LIVEKIT_HTTP_URL"] = "https://127.0.0.1:7883"
    env["LIVEKIT_API_KEY"] = creds["livekitKey"]
    env["LIVEKIT_API_SECRET"] = creds["livekitSecret"]
    env["E2E_PASSWORD"] = creds["password"]
    env["E2E_TLS_CERT"] = str(RUN / "cert.pem")
    env["E2E_TLS_KEY"] = str(RUN / "key.pem")
    env["E2E_TLS_PORT"] = "7883"
    env["E2E_LIVEKIT_PORT"] = "7880"
    env["VITE_API_PROXY"] = "http://127.0.0.1:8011"
    env["CHANNEL_LAYER_BACKEND"] = "inmemory"
    return env


def spawn(name, args, env, cwd):
    log = open(RUN / f"{name}.log", "w", encoding="utf-8")
    proc = subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    return {"name": name, "pid": proc.pid, "proc": proc}


def wait_http(url, timeout=90):
    import urllib.request

    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return response.status
        except Exception as exc:
            last = type(exc).__name__
        time.sleep(0.4)
    raise SystemExit(f"timeout waiting for {url} ({last})")


def wait_tls(timeout=30):
    import ssl
    import urllib.request

    deadline = time.time() + timeout
    context = ssl._create_unverified_context()
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("https://127.0.0.1:7883/", timeout=2, context=context) as response:
                return response.status
        except Exception:
            time.sleep(0.3)
    raise SystemExit("timeout waiting for local livekit tls")


def stop(children):
    for child in children:
        proc = child["proc"]
        if proc.poll() is not None:
            continue
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    deadline = time.time() + 8
    for child in children:
        remaining = max(0, deadline - time.time())
        try:
            child["proc"].wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child["proc"].pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def main():
    assert_ports_free()
    params = load_db_params()
    db_info = ensure_database(params)
    creds = ensure_secrets()
    env = stand_env(creds)
    def django_manage(*args):
        return subprocess.run(
            [str(PYTHON), str(ROOT / "manage.py"), *args],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )

    # Свежая база не проходит каталожные data-миграции: они читают текущую
    # модель, а колонка import_key появляется только в 0119. Каталог стенду
    # не нужен. Откатывать уже применённые миграции нельзя.
    seeds = (
        "0094_seed_catalog_math_oge",
        "0095_seed_catalog_phys_oge",
        "0096_seed_catalog_inf_oge",
        "0097_seed_catalog_rus_oge",
        "0098_seed_catalog_math_ege",
        "0099_seed_catalog_inf_ege",
    )
    seen = subprocess.run(
        [str(PYTHON), "-c",
         "import django; django.setup();"
         "from django.db import connection;"
         "with connection.cursor() as c:\n"
         "    c.execute(\"SELECT to_regclass('public.django_migrations')\")\n"
         "    if not c.fetchone()[0]:\n"
         "        print(''); raise SystemExit(0)\n"
         "from django.db.migrations.recorder import MigrationRecorder\n"
         "print(' '.join(MigrationRecorder.Migration.objects.filter(app='Cabinet').values_list('name', flat=True)))"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    applied_names = set((seen.stdout or "").split())
    if "0120_meeting_call_route" not in applied_names:
        if "0093_lessonplan_is_public" not in applied_names:
            base = django_manage("migrate", "Cabinet", "0093_lessonplan_is_public", "--noinput")
            if base.returncode != 0:
                raise SystemExit(f"migrate to 0093 failed\n{(base.stderr or base.stdout)[-800:]}")
        for name in seeds:
            if name in applied_names:
                continue
            fake = django_manage("migrate", "Cabinet", name, "--fake")
            if fake.returncode != 0:
                raise SystemExit(f"could not skip catalog seed {name}\n{(fake.stderr or fake.stdout)[-800:]}")
    migrate = subprocess.run(
        [str(PYTHON), str(ROOT / "manage.py"), "migrate", "--noinput"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    if migrate.returncode != 0:
        tail = (migrate.stderr or migrate.stdout or "")[-800:]
        raise SystemExit(f"migrate failed\n{tail}")
    children = []
    try:
        children.append(spawn(
            "livekit",
            ["/opt/homebrew/bin/livekit-server", "--config", str(RUN / "livekit.yaml")],
            env,
            ROOT,
        ))
        children.append(spawn(
            "tls",
            ["node", str(STAND / "tls_proxy.mjs")],
            env,
            ROOT,
        ))
        children.append(spawn(
            "django",
            [str(PYTHON), str(ROOT / "manage.py"), "runserver", "127.0.0.1:8011", "--noreload"],
            env,
            ROOT,
        ))
        children.append(spawn(
            "vite",
            [
                str(ROOT / "frontend" / "node_modules" / ".bin" / "vite"),
                "--host", "127.0.0.1",
                "--port", "5011",
                "--strictPort",
            ],
            env,
            ROOT / "frontend",
        ))
        wait_tls()
        wait_http("http://127.0.0.1:8011/api/cabinet/me/")
        wait_http("http://127.0.0.1:5011/")
        seed = subprocess.run(
            [str(PYTHON), str(STAND / "seed_stand.py")],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        if seed.returncode != 0:
            raise SystemExit(f"seed failed\n{(seed.stderr or seed.stdout)[-800:]}")
        print(seed.stdout.strip())
        probe_env = {
            **env,
            "PLAYWRIGHT_BROWSERS_PATH": str(Path.home() / "Library/Caches/ms-playwright"),
        }
        probe = subprocess.run(
            ["node", str(STAND / "probe.cjs")],
            cwd=ROOT,
            env=probe_env,
            text=True,
        )
        summary = {
            "database": db_info,
            "probeExit": probe.returncode,
            "ports": PORTS,
        }
        (RUN / "stand-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        return probe.returncode
    finally:
        stop(children)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print(f"stand failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
