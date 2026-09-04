#!/usr/bin/env bash
# Publish every workspace package in dependency order.
#
#   npm login                      # once; 2FA token lands in ~/.npmrc
#   scripts/publish-all.sh 123456   # the six-digit code from your authenticator,
#                                  # or no argument to let npm prompt for it
#
# Already-published versions are skipped, so the script can be re-run with a
# fresh OTP if the first one expires part-way through. Order matters: a
# package's @xbg.solutions ranges must resolve on the registry before it is
# published, and npm does not sort workspaces for you.
set -u
OTP="${1:-}"
cd "$(dirname "$0")/.."

# Everything that reaches the console is also appended to a timestamped log
# under scripts/publish-logs/, so a failure can be read back after the fact.
mkdir -p scripts/publish-logs
LOG="scripts/publish-logs/publish-$(date +%Y%m%dT%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "publish run $(date -Iseconds) as $(npm whoami 2>/dev/null || echo 'NOT LOGGED IN') -> $LOG"
ORDER="utils-logger utils-cache-connector utils-events utils-firebase-event-bridge utils-firestore-connector utils-token-handler backend-core create-backend utils-errors utils-address-validation utils-crm-connector utils-document-connector utils-email-connector utils-erp-connector utils-hashing utils-journey-connector utils-llm-connector utils-notification-inbox-connector utils-push-notifications-connector utils-realtime-connector utils-sms-connector utils-survey-connector utils-timezone utils-validation utils-work-mgmt-connector"
failed=""
for short in $ORDER; do
  name="@xbg.solutions/$short"
  version=$(node -p "require('./packages/$short/package.json').version")
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip    $name@$version (already on the registry)"; continue
  fi
  if npm publish -w "$name" --access public ${OTP:+--otp="$OTP"}; then
    echo "ok      $name@$version"
  else
    echo "FAILED  $name@$version (E401/E404 = not logged in; EOTP = code expired, re-run with a new one)"
    failed="$failed $short"
  fi
done
[ -z "$failed" ] && echo "all published (log: $LOG)" || { echo "not published:$failed (log: $LOG)"; exit 1; }
