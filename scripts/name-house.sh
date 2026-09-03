#!/usr/bin/env bash
# Optional: map house.local to this machine. Safe to re-run.
set -euo pipefail
if ! grep -qE '(^|[[:space:]])house\.local([[:space:]]|$)' /etc/hosts; then
  printf '\n127.0.0.1\thouse.local house.localhost\n' | sudo tee -a /etc/hosts >/dev/null
  echo "Added house.local to /etc/hosts"
else
  echo "house.local already in /etc/hosts"
fi
if command -v dscacheutil >/dev/null 2>&1; then
  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true
fi
echo "Open http://house.local"
