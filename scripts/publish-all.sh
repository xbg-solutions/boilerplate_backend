#!/usr/bin/env bash
# Publish every workspace package in dependency order.
#
#   npm login                      # once; 2FA token lands in ~/.npmrc
#   scripts/publish-all.sh <otp>   # OTP from the authenticator
#
# Already-published versions are skipped, so the script can be re-run with a
# fresh OTP if the first one expires part-way through. Order matters: a
# package's @xbg.solutions ranges must resolve on the registry before it is
# published, and npm does not sort workspaces for you.
set -u
OTP="${1:?usage: $0 <otp>}"
cd "$(dirname "$0")/.."
ORDER="utils-logger utils-cache-connector utils-events utils-firebase-event-bridge utils-firestore-connector utils-token-handler backend-core create-backend utils-errors utils-address-validation utils-crm-connector utils-document-connector utils-email-connector utils-erp-connector utils-hashing utils-journey-connector utils-llm-connector utils-notification-inbox-connector utils-push-notifications-connector utils-realtime-connector utils-sms-connector utils-survey-connector utils-timezone utils-validation utils-work-mgmt-connector"
failed=""
for short in $ORDER; do
  name="@xbg.solutions/$short"
  version=$(node -p "require('./packages/$short/package.json').version")
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip    $name@$version (already on the registry)"; continue
  fi
  if npm publish -w "$name" --access public --otp="$OTP" >/dev/null 2>&1; then
    echo "ok      $name@$version"
  else
    echo "FAILED  $name@$version (E401/E404 = not logged in; EOTP = code expired, re-run with a new one)"
    failed="$failed $short"
  fi
done
[ -z "$failed" ] && echo "all published" || { echo "not published:$failed"; exit 1; }
