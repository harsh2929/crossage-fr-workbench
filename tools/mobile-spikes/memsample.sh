#!/bin/bash
# Sample the simulator app process's resident memory during the benchmark.
# The simulator runs the app as a real macOS process, so RSS here is a genuine
# measurement of the app's memory footprint (not a proxy).
OUT="$1"; DUR="${2:-90}"
: > "$OUT"
end=$(( $(date +%s) + DUR ))
peak=0
while [ "$(date +%s)" -lt "$end" ]; do
  pid=$(pgrep -f "gridbench.app/gridbench" | head -1)
  if [ -n "$pid" ]; then
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -n "$rss" ]; then
      mb=$(( rss / 1024 ))
      [ "$mb" -gt "$peak" ] && peak=$mb
      echo "$(date +%s) $mb" >> "$OUT"
    fi
  fi
  sleep 0.25
done
echo "PEAK_MB=$peak" >> "$OUT"
echo "peak=${peak}MB"
