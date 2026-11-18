#!/usr/bin/env bash
# Runs every screen check in tests/ui against a local copy of the app.
# Usage (from the project folder):  bash tests/run-ui.sh            (all checks)
#                                   bash tests/run-ui.sh esc keyboard (just these)
# Needs Node and Playwright with Chromium (pre-installed in Claude cloud sessions).
# Uses only made-up data from tests/fixtures. Screenshots go to a temp folder.
cd "$(dirname "$0")/.." || exit 1
ROOT=$PWD
BIG=$ROOT/tests/fixtures/sample-data.json
SMALL=$ROOT/tests/fixtures/small-data.json
MOCK=$ROOT/tests/helpers/mock-supabase.js
OUT=${OUT:-$(mktemp -d)}

# check name : data file : needs the pretend cloud
CHECKS="
smoke:big
phone-sizes:big
pin:big
pin-remove:-
redesign:big
session:-
sync:big:cloud
drag-and-menus:big
undo:big
fixes:small
keyboard:small
esc:small
brave-esc:small
keyboard-modality:small
menu:-:cloud
esc-signed-in:-:cloud
offline:-
odd-data:-
"

if ! curl -s -o /dev/null "http://localhost:8123/"; then
  setsid -f python3 -m http.server 8123 --directory "$ROOT" >/dev/null 2>&1 </dev/null
  sleep 1
fi
CLOUD_PID=
start_cloud() {
  [ -n "$CLOUD_PID" ] && kill "$CLOUD_PID" 2>/dev/null && sleep 0.3
  node "$ROOT/tests/helpers/fake-cloud.js" >/dev/null 2>&1 </dev/null &
  CLOUD_PID=$!
  sleep 0.6
}
trap '[ -n "$CLOUD_PID" ] && kill $CLOUD_PID 2>/dev/null' EXIT

total_pass=0; total_fail=0; broken=()
for line in $CHECKS; do
  IFS=: read -r name data cloud <<<"$line"
  if [ $# -gt 0 ] && [[ " $* " != *" $name "* ]]; then continue; fi
  case $data in big) file=$BIG ;; small) file=$SMALL ;; *) file=- ;; esac
  [ "$cloud" = cloud ] && start_cloud
  log=$(timeout 240 node "$ROOT/tests/ui/$name.js" "$file" "$OUT" "$MOCK" 2>&1); code=$?
  pass=$(grep -c '^PASS' <<<"$log"); fail=$(grep -c '^FAIL' <<<"$log")
  total_pass=$((total_pass + pass)); total_fail=$((total_fail + fail))
  if [ "$fail" -gt 0 ] || [ "$code" -ne 0 ] || [ "$pass" -eq 0 ]; then
    broken+=("$name"); echo "✗ $name  ($pass passed, $fail failed)"
    grep -v '^PASS' <<<"$log" | head -20 | sed 's/^/    /'
  else
    echo "✓ $name  ($pass passed)"
  fi
done
echo
echo "Total: $total_pass passed, $total_fail failed. Screenshots: $OUT"
[ ${#broken[@]} -eq 0 ] || { echo "Problems in: ${broken[*]}"; exit 1; }
