#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Rudolph"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${ROOT_DIR}/VERSION"
MANIFEST_PATH="${ROOT_DIR}/manifest.json"
DIST_DIR="${ROOT_DIR}/dist"

usage() {
  cat <<USAGE
Usage: ./package.sh

Creates one installable Chrome extension zip in ./dist.
The zip has manifest.json at its root and is suitable for Chrome extension
distribution or manual unzip/load testing.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 0 ]]; then
  usage >&2
  exit 2
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command '$1' was not found" >&2
    exit 1
  fi
}

read_version() {
  if [[ ! -f "${VERSION_FILE}" ]]; then
    echo "error: ${VERSION_FILE} does not exist" >&2
    exit 1
  fi

  VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
  if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: VERSION must contain a semver in MAJOR.MINOR.PATCH form" >&2
    exit 1
  fi
}

manifest_version() {
  python3 - "${MANIFEST_PATH}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["version"])
PY
}

verify_manifest_version() {
  local version
  version="$(manifest_version)"
  if [[ "${version}" != "${VERSION}" ]]; then
    echo "error: manifest.json version ${version} does not match VERSION ${VERSION}" >&2
    exit 1
  fi
}

package_extension() {
  ZIP_PATH="${DIST_DIR}/${APP_NAME}-${VERSION}-chrome-extension.zip"

  mkdir -p "${DIST_DIR}"
  rm -f "${ZIP_PATH}"

  python3 - "${ROOT_DIR}" "${ZIP_PATH}" <<'PY'
import os
import sys
import zipfile

root, zip_path = sys.argv[1:3]
include_paths = [
    "manifest.json",
    "newtab.html",
    "css/gridstack.min.css",
    "css/styles.css",
    "js/app.js",
    "js/theme-bootstrap.js",
    "js/chart.umd.min.js",
    "js/gridstack.min.js",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
]

missing = [path for path in include_paths if not os.path.isfile(os.path.join(root, path))]
if missing:
    raise SystemExit("missing extension files: " + ", ".join(missing))

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for rel_path in include_paths:
        archive.write(os.path.join(root, rel_path), rel_path)
PY

  echo "Created ${ZIP_PATH}"
}

require_command python3
read_version
verify_manifest_version
package_extension
