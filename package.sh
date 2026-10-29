#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Rudolph"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${ROOT_DIR}/VERSION"
PACKAGE_PATH="${ROOT_DIR}/package.json"
BUILD_DIR="${ROOT_DIR}/build/chrome-mv3"
DIST_DIR="${ROOT_DIR}/dist"

usage() {
  cat <<USAGE
Usage: ./package.sh

Builds the production WXT extension and creates one installable zip in ./dist.
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

verify_package_version() {
  python3 - "${PACKAGE_PATH}" "${VERSION}" <<'PYTHON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    version = json.load(handle)["version"]
if version != sys.argv[2]:
    raise SystemExit("error: package.json version does not match VERSION")
PYTHON
}

package_extension() {
  ZIP_PATH="${DIST_DIR}/${APP_NAME}-${VERSION}-chrome-extension.zip"

  mkdir -p "${DIST_DIR}"

  python3 - "${BUILD_DIR}" "${ZIP_PATH}" "${VERSION}" <<'PYTHON'
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile

build, zip_path, version = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
with (build / "manifest.json").open(encoding="utf-8") as handle:
    manifest = json.load(handle)
if manifest.get("version") != version:
    raise SystemExit("error: generated manifest version does not match VERSION")
entrypoint = manifest.get("chrome_url_overrides", {}).get("newtab")
if not entrypoint or not (build / entrypoint).is_file():
    raise SystemExit("error: generated extension is missing its new-tab entrypoint")

# Package only generated extension assets; never include repository files or links.
files = sorted(build.rglob("*"))
if any(file.is_symlink() for file in files):
    raise SystemExit("error: generated extension must not contain symbolic links")
with tempfile.NamedTemporaryFile(dir=zip_path.parent, suffix=".zip", delete=False) as handle:
    temp_path = Path(handle.name)
try:
    with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            if file.is_file():
                archive.write(file, file.relative_to(build).as_posix())
    os.replace(temp_path, zip_path)
finally:
    temp_path.unlink(missing_ok=True)
PYTHON

  echo "Created ${ZIP_PATH}"
}

require_command python3
require_command npm
read_version
verify_package_version
(cd "${ROOT_DIR}" && npm run build)
package_extension
