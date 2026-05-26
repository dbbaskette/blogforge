#!/usr/bin/env bash
set -euo pipefail

E2E_DRAFTS="/tmp/pencraft-e2e-drafts"
E2E_PACKS="/tmp/pencraft-e2e-packs"
E2E_CFG="/tmp/pencraft-e2e-myvoice-config.yaml"
E2E_MOCK_JSON="/tmp/pencraft-e2e-mock-outline.json"
MYVOICE_REPO="/Users/dbbaskette/Projects/myvoice"

rm -rf "$E2E_DRAFTS" "$E2E_PACKS"
cp -R "$MYVOICE_REPO/packs" "$E2E_PACKS"
printf 'version: 1\nproviders:\n  anthropic:\n    api_key: sk-mock\n' > "$E2E_CFG"
# Write mock outline JSON to a file so the backend can read it without shell quoting issues
printf '%s\n' '{"opening_hook":"An opening hook for the e2e test.","sections":[{"id":"s1","title":"First section","brief":"Brief one"},{"id":"s2","title":"Second section","brief":"Brief two"}],"estimated_words":600}' > "$E2E_MOCK_JSON"
echo "e2e setup complete"
