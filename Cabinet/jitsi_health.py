"""Read-only диагностика Jitsi на хосте. Ничего не перезапускает."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from typing import Any

from django.conf import settings

from .jitsi_service import get_jitsi_auth_mode, get_jitsi_domain, get_jitsi_sub

SECRET_ENV_RE = re.compile(r"(SECRET|PASSWORD|TOKEN|KEY)=.*", re.I)


def _run(argv: list[str], timeout: int = 8) -> tuple[int, str]:
    if not argv or not shutil.which(argv[0]):
        return 127, ""
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        return proc.returncode, out.strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


def _redact(text: str) -> str:
    return SECRET_ENV_RE.sub(lambda m: m.group(1) + "=***REDACTED***", text or "")


def _level(status: str) -> str:
    return status if status in {"OK", "WARNING", "CRITICAL"} else "WARNING"


def _add(findings: list[dict], *, status: str, code: str, message: str, data: dict | None = None) -> None:
    findings.append(
        {
            "status": _level(status),
            "code": code,
            "message": message,
            "data": data or {},
        }
    )


def inspect_settings() -> dict[str, Any]:
    domain = get_jitsi_domain()
    auth_mode = get_jitsi_auth_mode()
    app_id = (getattr(settings, "JITSI_APP_ID", "") or "").strip()
    app_secret = (getattr(settings, "JITSI_APP_SECRET", "") or "").strip()
    return {
        "domain": domain,
        "sub": get_jitsi_sub(),
        "aud": (getattr(settings, "JITSI_AUD", "") or "").strip() or "jitsi",
        "authMode": auth_mode,
        "appIdSet": bool(app_id),
        "appSecretSet": bool(app_secret),
        "appId": app_id[:32] if app_id else "",
        "jwtConfigured": bool(app_id and app_secret),
    }


def parse_udp_10000(ss_output: str) -> list[dict[str, str]]:
    rows = []
    for line in (ss_output or "").splitlines():
        if "10000" not in line:
            continue
        pid = ""
        proc = ""
        match = re.search(r'users:\(\("([^"]+)",pid=(\d+)', line)
        if match:
            proc, pid = match.group(1), match.group(2)
        addr = ""
        addr_match = re.search(r"(\S+):10000", line)
        if addr_match:
            addr = addr_match.group(1)
        rows.append({"line": line.strip()[:240], "pid": pid, "process": proc, "address": addr})
    return rows


def parse_docker_ps(text: str) -> list[dict[str, str]]:
    rows = []
    for line in (text or "").splitlines():
        if "jitsi" not in line.lower() and "jvb" not in line.lower() and "jicofo" not in line.lower() and "prosody" not in line.lower():
            continue
        parts = [p for p in re.split(r"\s{2,}", line.strip()) if p]
        if len(parts) < 2:
            continue
        rows.append(
            {
                "name": parts[0],
                "status": parts[1] if len(parts) > 1 else "",
                "ports": parts[-1] if len(parts) > 2 else "",
            }
        )
    return rows


def collect_host_snapshot() -> dict[str, Any]:
    code_ss_u, ss_u = _run(["ss", "-lunp"])
    code_ss_t, ss_t = _run(["ss", "-ltnp"])
    _, units = _run(["systemctl", "list-units", "--type=service", "--all", "--no-pager"])
    services = {}
    for name in ("prosody", "jicofo", "jitsi-videobridge2", "nginx", "docker", "itflux"):
        active_code, active = _run(["systemctl", "is-active", name])
        enabled_code, enabled = _run(["systemctl", "is-enabled", name])
        services[name] = {
            "active": (active or "unknown").splitlines()[0],
            "enabled": (enabled or "unknown").splitlines()[0],
            "isActive": active_code == 0 and (active or "").strip() == "active",
        }
    _, docker_ps = _run(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"])
    _, ufw = _run(["ufw", "status"])
    _, ip_addr = _run(["ip", "-4", "addr"])
    jvb_conf = ""
    for path in ("/etc/jitsi/videobridge/jvb.conf",):
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    jvb_conf = fh.read()
            except OSError:
                jvb_conf = ""
    jvb_conf_safe = re.sub(r'(PASSWORD|SECRET)\s*=\s*".*?"', r'\1="***"', jvb_conf, flags=re.I)
    advertised = re.findall(
        r"(?:local-address|public-address|mapped-address|DOCKER_HOST_ADDRESS|JVB_ADVERTISE_IPS)\s*=\s*\"?([0-9.]+)\"?",
        jvb_conf_safe,
    )
    docker_internal = sorted({addr for addr in advertised if addr.startswith(("172.", "10.", "192.168."))})
    public_addrs = sorted({addr for addr in advertised if not addr.startswith(("172.", "10.", "192.168.", "127."))})
    return {
        "ssUdp": ss_u if code_ss_u != 127 else "",
        "ssTcp": ss_t if code_ss_t != 127 else "",
        "udp10000": parse_udp_10000(ss_u),
        "units": _redact(units),
        "services": services,
        "dockerPs": docker_ps,
        "dockerJitsi": parse_docker_ps(docker_ps),
        "ufw": ufw[:2000],
        "ipAddr": ip_addr[:2000],
        "jvbAdvertised": advertised,
        "jvbDockerInternal": docker_internal,
        "jvbPublic": public_addrs,
        "jvbConfHasStun": "stun" in jvb_conf_safe.lower(),
        "hostAvailable": code_ss_u != 127 or bool(services.get("prosody")),
    }


def diagnose(snapshot: dict[str, Any] | None = None, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    snapshot = snapshot or {}
    cfg = cfg or inspect_settings()
    findings: list[dict] = []

    if not cfg.get("domain"):
        _add(findings, status="CRITICAL", code="no_domain", message="JITSI_DOMAIN не задан")
    if cfg.get("authMode") == "jwt" and not cfg.get("jwtConfigured"):
        _add(findings, status="CRITICAL", code="jwt_incomplete", message="JWT включён, но APP_ID/SECRET не заданы")
    elif cfg.get("jwtConfigured"):
        _add(
            findings,
            status="OK",
            code="jwt_present",
            message="JWT app_id задан, секрет не выводится",
            data={"appIdSet": True, "sub": cfg.get("sub")},
        )

    udp = snapshot.get("udp10000") or []
    pids = {row.get("pid") for row in udp if row.get("pid")}
    docker_addrs = [row for row in udp if "172." in (row.get("address") or "") or "172." in (row.get("line") or "")]
    if snapshot.get("hostAvailable") and not udp:
        _add(findings, status="CRITICAL", code="udp_10000_missing", message="UDP 10000 никто не слушает")
    elif len(pids) > 1:
        _add(
            findings,
            status="CRITICAL",
            code="duplicate_jvb",
            message="UDP 10000 слушают несколько процессов — два JVB",
            data={"pids": sorted(pids)},
        )
    elif udp:
        _add(
            findings,
            status="OK" if not docker_addrs else "WARNING",
            code="udp_10000_bound",
            message="UDP 10000 слушает native JVB" if not docker_addrs else "JVB слушает UDP 10000 и на docker-bridge 172.x",
            data={"listeners": udp[:8]},
        )

    docker_rows = snapshot.get("dockerJitsi") or []
    running_docker = [row for row in docker_rows if str(row.get("status", "")).lower().startswith("up")]
    created_docker = [row for row in docker_rows if "created" in str(row.get("status", "")).lower()]
    if running_docker:
        _add(
            findings,
            status="WARNING",
            code="docker_jitsi_leftover",
            message="Запущен leftover Docker Jitsi рядом с native stack",
            data={"containers": running_docker},
        )
    if created_docker:
        _add(
            findings,
            status="WARNING",
            code="docker_jvb_not_started",
            message="Docker JVB/web в статусе Created (часто UDP 10000 already in use)",
            data={"containers": created_docker},
        )

    services = snapshot.get("services") or {}
    native = [name for name in ("prosody", "jicofo", "jitsi-videobridge2") if services.get(name, {}).get("isActive")]
    if native == ["prosody", "jicofo", "jitsi-videobridge2"]:
        _add(findings, status="OK", code="native_stack", message="Canonical stack: systemd Prosody + Jicofo + JVB")
    elif snapshot.get("hostAvailable") and native:
        _add(
            findings,
            status="CRITICAL",
            code="native_stack_incomplete",
            message="Часть native Jitsi сервисов не active",
            data={"active": native, "services": {k: v.get("active") for k, v in services.items()}},
        )

    if snapshot.get("jvbDockerInternal"):
        _add(
            findings,
            status="CRITICAL",
            code="jvb_advertises_docker_ip",
            message="JVB рекламирует docker-internal адрес — ICE для клиентов с интернета ломается",
            data={"addresses": snapshot.get("jvbDockerInternal")},
        )
    elif snapshot.get("jvbPublic"):
        _add(
            findings,
            status="OK",
            code="jvb_public_ip",
            message="JVB static mapping указывает на публичный адрес",
            data={"addresses": snapshot.get("jvbPublic")},
        )

    if not findings:
        _add(findings, status="WARNING", code="host_unavailable", message="Команда запущена не на Jitsi-хосте; проверен только Django config")

    worst = "OK"
    for item in findings:
        if item["status"] == "CRITICAL":
            worst = "CRITICAL"
            break
        if item["status"] == "WARNING":
            worst = "WARNING"
    return {
        "overall": worst,
        "jitsi": cfg,
        "findings": findings,
        "snapshot": {
            "udp10000": udp,
            "services": {k: v.get("active") for k, v in services.items()},
            "dockerJitsi": docker_rows,
            "jvbAdvertised": snapshot.get("jvbAdvertised") or [],
        },
    }


def format_report(report: dict[str, Any]) -> str:
    lines = [
        f"audit_jitsi_health [{report.get('overall')}]",
        f"domain={report.get('jitsi', {}).get('domain')} auth={report.get('jitsi', {}).get('authMode')} "
        f"sub={report.get('jitsi', {}).get('sub')} jwt={report.get('jitsi', {}).get('jwtConfigured')}",
        "",
    ]
    for item in report.get("findings") or []:
        lines.append(f"[{item['status']}] {item['code']}: {item['message']}")
        data = item.get("data") or {}
        if data:
            lines.append("    " + json.dumps(data, ensure_ascii=False)[:500])
    snap = report.get("snapshot") or {}
    if snap.get("udp10000"):
        lines.append("")
        lines.append("UDP 10000:")
        for row in snap["udp10000"][:8]:
            lines.append("    " + (row.get("line") or ""))
    if snap.get("dockerJitsi"):
        lines.append("Docker Jitsi:")
        for row in snap["dockerJitsi"]:
            lines.append(f"    {row.get('name')} {row.get('status')} {row.get('ports')}")
    return "\n".join(lines)
