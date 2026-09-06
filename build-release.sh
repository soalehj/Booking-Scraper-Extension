#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/dist"
PACKAGE_NAME="booking-scraper-extension.zip"

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_DIR}/${PACKAGE_NAME}"

cd "${SCRIPT_DIR}"
zip -q "${OUTPUT_DIR}/${PACKAGE_NAME}" \
  manifest.json \
  background.js \
  content.js \
  injected.js \
  popup.html \
  popup.js

printf 'Paket rilis dibuat: %s\n' "${OUTPUT_DIR}/${PACKAGE_NAME}"