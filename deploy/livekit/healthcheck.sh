#!/bin/sh
# Локальная проверка сигналинга. Тело ответа не печатает.
set -eu
curl -fsS --max-time 3 http://127.0.0.1:7880/ -o /dev/null
echo "livekit-http ok"
