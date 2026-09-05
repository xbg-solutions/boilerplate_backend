#!/usr/bin/env bash
# Publish every workspace package in dependency order.
#
#   npm login                      # once; 2FA token lands in ~/.npmrc
#   scripts/publish-all.sh          # npm completes 2FA itself (browser, passkey,
#                                  # security key, or a code prompt)
#   scripts/publish-all.sh 123456   # optional: a TOTP code, if that is what you use
#
# Already-published versions are skipped, so the script can be re-run with a
# fresh OTP if the first one expires part-way through. Order matters: a
# package's @xbg.solutions ranges must resolve on the registry before it is
# published, and npm does not sort workspaces for you.
set -u
OTP="${1:-}"
cd "$(dirname "$0")/.."

# Everything that reaches the console is also captured in a timestamped log
# under scripts/publish-logs/. It is captured with `script`, not `tee`: a pipe
# on stdout makes npm think it is non-interactive and it then demands a typed
# one-time code instead of opening the browser for the second factor.
mkdir -p scripts/publish-logs
if [ -z "${PUBLISH_LOG:-}" ]; then
  PUBLISH_LOG="scripts/publish-logs/publish-$(date +%Y%m%dT%H%M%S).log"
  export PUBLISH_LOG
  exec script -q "$PUBLISH_LOG" "$0" "$@"
fi
LOG="$PUBLISH_LOG"
echo "publish run $(date -Iseconds) as $(npm whoami 2>/dev/null || echo 'NOT LOGGED IN') -> $LOG"
ORDER="utils-logger utils-cache-connector utils-events utils-firebase-event-bridge utils-firestore-connector utils-token-handler backend-core create-backend utils-errors utils-address-validation utils-crm-connector utils-document-connector utils-email-connector utils-erp-connector utils-hashing utils-journey-connector utils-llm-connector utils-notification-inbox-connector utils-push-notifications-connector utils-realtime-connector utils-sms-connector utils-survey-connector utils-timezone utils-validation utils-work-mgmt-connector"
# Pass 1: work out what is still missing, BEFORE asking for a code, so the
# 30-second OTP window is not spent on registry lookups.
pending=""
for short in $ORDER; do
  name="@xbg.solutions/$short"
  dir=$(node -e "const fs=require('fs');for(const d of fs.readdirSync('packages')){const f='packages/'+d+'/package.json';if(fs.existsSync(f)&&JSON.parse(fs.readFileSync(f)).name==='$name'){console.log(d);break}}")
  if [ -z "$dir" ]; then echo "FAILED  $name (no workspace directory carries that name)"; exit 1; fi
  version=$(node -p "require('./packages/$dir/package.json').version")
  if [ -z "$version" ]; then echo "FAILED  $name (could not read version)"; exit 1; fi
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip    $name@$version (already on the registry)"
  else
    echo "pending $name@$version"
    pending="$pending $short:$dir:$version"
  fi
done
if [ -z "$pending" ]; then echo "nothing to publish (log: $LOG)"; exit 0; fi

# Pass 2: build everything pending now, so prepublishOnly's tsc is warm and
# quick, then publish. npm handles the second factor on its own.
for item in $pending; do
  dir=${item#*:}; dir=${dir%%:*}
  (cd "packages/$dir" && npm run build --if-present >/dev/null 2>&1) || echo "warning: build failed in packages/$dir (publish will retry it)"
done
if [ -z "$OTP" ]; then
  echo "No code given: npm will complete the second factor itself (browser / passkey / security key / prompt)."
fi

failed=""
for item in $pending; do
  short=${item%%:*}; rest=${item#*:}; dir=${rest%%:*}; version=${rest#*:}
  name="@xbg.solutions/$short"
  if npm publish -w "$name" --access public --auth-type=web ${OTP:+--otp="$OTP"} </dev/tty; then
    echo "ok      $name@$version"
  else
    echo "FAILED  $name@$version (EOTP = second factor not completed in time, re-run; E401/E404 = not logged in)"
    failed="$failed $short"
  fi
done
[ -z "$failed" ] && echo "all published (log: $LOG)" || { echo "not published:$failed (log: $LOG)"; exit 1; }
