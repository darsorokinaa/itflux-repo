#!/bin/bash
pid=$(systemctl show -p MainPID --value itflux)
if [ -z "$pid" ] || [ "$pid" = "0" ] || [ ! -d "/proc/$pid" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=missing" >> /var/log/itflux/daphne-rss.log
  exit 0
fi
rss=$(awk '/^VmRSS:/{print $2}' /proc/$pid/status)
hwm=$(awk '/^VmHWM:/{print $2}' /proc/$pid/status)
pss=$(awk '/^Pss:/{print $2}' /proc/$pid/smaps_rollup)
anon=$(awk '/^Anonymous:/{s+=$2} END {print s+0}' /proc/$pid/smaps)
heap=$(awk '$6=="[heap]"{print $2-$1}' /proc/$pid/smaps | awk '{s+=$1} END {print int(s/1024)}')
threads=$(awk '/^Threads:/{print $2}' /proc/$pid/status)
fds=$(ls /proc/$pid/fd | wc -l)
elapsed=$(ps -o etimes= -p $pid | tr -d ' ')
ws=$(ss -tn state established 2>/dev/null | awk '$4 ~ /:8002$/ || $4 ~ /:5858$/{c++} END {print c+0}')
pg=$(sudo -u postgres psql -d itflux -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname='itflux' AND backend_type='client backend'" 2>/dev/null || echo -1)
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$pid uptime_s=$elapsed rss_kb=$rss pss_kb=$pss anon_kb=$anon glibc_heap_kb=$heap threads=$threads fds=$fds established_ws=$ws pg_client_backends=$pg hwm_kb=$hwm" >> /var/log/itflux/daphne-rss.log

now=$(date +%s)
state=/var/log/itflux/daphne-rss-window
touch "$state"
echo "$now $rss" >> "$state"
tmp=$(mktemp)
awk -v now="$now" 'now-$1<=300 {print}' "$state" > "$tmp"
mv "$tmp" "$state"
min=$(awk 'NR==1 || $2<m {m=$2} END {print m+0}' "$state")
if [ $((rss - min)) -ge 102400 ]; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  dir=/var/log/itflux/smaps/${stamp}-jump
  mkdir -p "$dir"
  cp /proc/$pid/status "$dir/status"
  cp /proc/$pid/smaps_rollup "$dir/smaps_rollup"
  cp /proc/$pid/smaps "$dir/smaps"
  cp /proc/$pid/maps "$dir/maps"
  echo "$now $rss" > "$state"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rss_jump rss_kb=$rss baseline_kb=$min dump=$dir" >> /var/log/itflux/daphne-rss.log
fi
