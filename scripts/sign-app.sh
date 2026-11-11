#!/bin/bash
# Sign a packaged bundle with a local code-signing certificate.
#
# Why: without this the app is only ad-hoc (linker) signed, so its code hash changes on
# every build and macOS TCC treats each install as a brand-new app — which means it asks
# for Calendar access again after every `install-app`. A certificate gives the bundle a
# stable identity, so the permission sticks.
#
# The certificate is a self-signed Code Signing cert in the login keychain (default name
# "AI Center Dev", override with AI_CENTER_SIGN_IDENTITY). It is NOT an Apple Developer ID:
# Gatekeeper still shows "unidentified developer" on first launch (right-click -> Open once).
#
# One-time setup, needs a GUI prompt so run it yourself:
#   security set-key-partition-list -S apple-tool:,apple:,codesign: \
#     -k "<your login password>" -s ~/Library/Keychains/login.keychain-db
#
# If no usable identity is found this exits 0 with a warning: packaging must never break
# because the certificate is missing on another machine.
set -uo pipefail

APP=${1:?usage: sign-app.sh <path to .app>}
IDENTITY=${AI_CENTER_SIGN_IDENTITY:-AI Center Dev}

# The hash, not the name: find-identity hides a self-signed cert from its "valid" list
# (CSSMERR_TP_NOT_TRUSTED), but codesign signs with it fine once the key is accessible.
HASH=$(security find-identity -p codesigning | grep -F "\"$IDENTITY\"" | head -1 | awk '{print $2}')
if [ -z "$HASH" ]; then
  echo "sign-app: no code-signing certificate named \"$IDENTITY\"; leaving the bundle ad-hoc signed." >&2
  echo "sign-app: create one in Keychain Access (Certificate Assistant > Create a Certificate," >&2
  echo "sign-app: Self Signed Root, Code Signing), then re-run." >&2
  exit 0
fi

# Bottom-up: nested code must be signed before the bundle that seals it.
sign() { codesign --force --timestamp=none --sign "$HASH" "$1" || return 1; }

targets=()
while IFS= read -r t; do targets+=("$t"); done < <(
  find "$APP/Contents/Frameworks" -maxdepth 1 -name '*.framework' -o -maxdepth 1 -name '*.app' 2>/dev/null
)
targets+=("$APP/Contents/Resources/calendar-helper" "$APP")

for t in "${targets[@]}"; do
  [ -e "$t" ] || continue
  if ! sign "$t"; then
    echo "sign-app: failed on $t" >&2
    echo "sign-app: errSecInternalComponent usually means codesign cannot reach the private key." >&2
    echo "sign-app: run the set-key-partition-list command at the top of this script, then retry." >&2
    exit 1
  fi
done

echo "sign-app: signed $(basename "$APP") as \"$IDENTITY\""
codesign -dv "$APP" 2>&1 | grep -E '^(Identifier|Signature|Authority)'
