"""Show whether a Twisted log line or a root logger line stalls the reactor.

Daphne at the default verbosity installs a no-op Twisted observer. The root
logger still writes to stderr on the calling thread. This process fills its
own stderr pipe, then emits both kinds of log line and checks that a reactor
callback scheduled after the write still runs.
"""

from __future__ import annotations

import logging
import os
import sys
import time

from twisted.internet import reactor
from twisted.logger import Logger, globalLogBeginner

MODE = os.environ.get("STDERR_MODE", "twisted-noop")
os.write(1, f"mode={MODE}\n".encode())


def fill_stderr() -> None:
    import fcntl

    flags = fcntl.fcntl(2, fcntl.F_GETFL)
    fcntl.fcntl(2, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    chunk = b"e" * 4096
    while True:
        try:
            os.write(2, chunk)
        except OSError:
            break
    fcntl.fcntl(2, fcntl.F_SETFL, flags)


def tick(label: str) -> None:
    os.write(1, f"tick {label} {time.monotonic():.3f}\n".encode())


def main() -> None:
    if MODE == "twisted-noop":
        globalLogBeginner.beginLoggingTo(
            [lambda _: None], redirectStandardIO=False, discardBuffer=True
        )
    elif MODE == "root-queued":
        from Cabinet.loop_log import protect_logger

        logging.basicConfig(level=logging.INFO)
        protect_logger("")
    else:
        logging.basicConfig(level=logging.INFO)

    fill_stderr()
    tick("before")

    def emit() -> None:
        if MODE == "twisted-noop":
            Logger("probe").error("twisted probe failed")
        else:
            logging.getLogger("django.request").warning("Bad Request: /probe/")
        reactor.callLater(0.05, tick, "after")
        reactor.callLater(0.2, reactor.stop)

    reactor.callLater(0.05, emit)
    reactor.run()


if __name__ == "__main__":
    main()
