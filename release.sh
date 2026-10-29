#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Rudolph"
REMOTE="${REMOTE:-origin}"
API_ROOT="${GITHUB_API_URL:-https://api.github.com}"
API_VERSION="2022-11-28"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${ROOT_DIR}/VERSION"
DIST_DIR="${ROOT_DIR}/dist"

DRY_RUN=0
CREATED_DRAFT_RELEASE_ID=""
RELEASE_PUBLISHED=0

usage() {
  cat <<USAGE
Usage: ./release.sh [--dry-run]

Creates a signed semantic version tag named v<VERSION>, pushes it, packages the
Chrome extension, creates a GitHub release with generated release notes, uploads
one extension zip asset, then publishes the release.

Required for release:
  - GITHUB_TOKEN with repository Contents: write permission
  - git tag signing configured for 'git tag -s'
  - curl
  - python3
  - npm dependencies installed with npm ci

Environment:
  REMOTE          Git remote to release from. Default: origin
  DEFAULT_BRANCH Default branch override if origin/HEAD is unavailable.
  GITHUB_API_URL GitHub API root. Default: https://api.github.com
USAGE
}

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
  --dry-run)
    DRY_RUN=1
    ;;
  "")
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command '$1' was not found" >&2
    exit 1
  fi
}

api_curl() {
  curl --fail-with-body -L \
    --silent \
    --show-error \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "X-GitHub-Api-Version: ${API_VERSION}" \
    "$@"
}

cleanup_draft_release() {
  if [[ -n "${CREATED_DRAFT_RELEASE_ID}" && "${RELEASE_PUBLISHED}" -eq 0 ]]; then
    echo "Cleaning up unpublished draft release ${CREATED_DRAFT_RELEASE_ID}..." >&2
    api_curl \
      -X DELETE \
      "${API_ROOT}/repos/${OWNER}/${REPO}/releases/${CREATED_DRAFT_RELEASE_ID}" >/dev/null || true
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

  local package_version
  package_version="$(python3 - "${ROOT_DIR}/package.json" <<'PYTHON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["version"])
PYTHON
)"
  if [[ "${package_version}" != "${VERSION}" ]]; then
    echo "error: package.json version ${package_version} does not match VERSION ${VERSION}" >&2
    exit 1
  fi

  TAG_NAME="v${VERSION}"
  RELEASE_NAME="${APP_NAME} ${VERSION}"
  ZIP_PATH="${DIST_DIR}/${APP_NAME}-${VERSION}-chrome-extension.zip"
}

repo_slug_from_remote() {
  local remote_url="$1"
  python3 - "${remote_url}" <<'PY'
import re
import sys

url = sys.argv[1].strip()
patterns = [
    r"^git@github\.com:(?P<slug>[^/]+/[^/]+?)(?:\.git)?$",
    r"^https://github\.com/(?P<slug>[^/]+/[^/]+?)(?:\.git)?$",
    r"^ssh://git@github\.com/(?P<slug>[^/]+/[^/]+?)(?:\.git)?$",
]

for pattern in patterns:
    match = re.match(pattern, url)
    if match:
        print(match.group("slug"))
        sys.exit(0)

sys.exit(1)
PY
}

resolve_repository() {
  local remote_url
  local repo_slug
  remote_url="$(git remote get-url "${REMOTE}")"
  repo_slug="$(repo_slug_from_remote "${remote_url}")" || {
    echo "error: could not derive GitHub owner/repo from ${REMOTE} URL: ${remote_url}" >&2
    exit 1
  }

  OWNER="${repo_slug%%/*}"
  REPO="${repo_slug#*/}"
}

resolve_default_branch() {
  local default_ref=""
  default_branch="${DEFAULT_BRANCH:-}"
  if [[ -z "${default_branch}" ]] && git show-ref --verify --quiet "refs/remotes/${REMOTE}/master"; then
    default_branch="master"
  fi
  if [[ -z "${default_branch}" ]] && git show-ref --verify --quiet "refs/remotes/${REMOTE}/main"; then
    default_branch="main"
  fi
  if [[ -z "${default_branch}" || "${default_branch}" == "${default_ref:-}" ]]; then
    default_ref="$(git symbolic-ref --quiet --short "refs/remotes/${REMOTE}/HEAD" 2>/dev/null || true)"
    default_branch="${default_ref#${REMOTE}/}"
  fi
  if [[ -z "${default_branch}" || "${default_branch}" == "${default_ref:-}" ]]; then
    default_branch="$(git branch --show-current)"
  fi
}

ensure_release_branch() {
  local current_branch
  current_branch="$(git branch --show-current)"
  if [[ "${current_branch}" != "${default_branch}" ]]; then
    echo "error: current branch is '${current_branch}', expected default branch '${default_branch}'" >&2
    exit 1
  fi
}

ensure_clean_worktree() {
  if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
    echo "error: worktree has uncommitted changes; release from a clean default branch" >&2
    exit 1
  fi
}

sync_release_ref() {
  echo "Fetching ${REMOTE}/${default_branch} and tags..."
  git fetch "${REMOTE}" "+refs/heads/${default_branch}:refs/remotes/${REMOTE}/${default_branch}" --tags

  remote_head="$(git rev-parse "${REMOTE}/${default_branch}")"
  local_head="$(git rev-parse HEAD)"
  if [[ "${local_head}" != "${remote_head}" ]]; then
    echo "error: HEAD is not ${REMOTE}/${default_branch}" >&2
    exit 1
  fi

  release_ref="${REMOTE}/${default_branch}"
  release_commit="${remote_head}"
}

prepare_dry_run_ref() {
  local_head="$(git rev-parse HEAD)"
  release_ref="HEAD"
  release_commit="${local_head}"
}

check_existing_tags() {
  LOCAL_TAG_EXISTS=0
  REMOTE_TAG_EXISTS=0
  LOCAL_TAG_CREATED=0

  if git rev-parse --verify --quiet "refs/tags/${TAG_NAME}" >/dev/null; then
    tag_head="$(git rev-list -n 1 "${TAG_NAME}")"
    if [[ "${tag_head}" != "${release_commit}" ]]; then
      echo "error: local tag ${TAG_NAME} already exists but does not point to ${release_ref}" >&2
      exit 1
    fi
    LOCAL_TAG_EXISTS=1
  fi

  remote_tag_head="$(git ls-remote --tags "${REMOTE}" "refs/tags/${TAG_NAME}" | awk 'NR == 1 { print $1 }')"
  if [[ -n "${remote_tag_head}" ]]; then
    remote_tag_commit="$(git rev-list -n 1 "${remote_tag_head}")"
    if [[ "${remote_tag_commit}" != "${release_commit}" ]]; then
      echo "error: remote tag ${TAG_NAME} already exists but does not point to ${release_ref}" >&2
      exit 1
    fi
    REMOTE_TAG_EXISTS=1
  fi
}

create_and_push_tag() {
  if [[ "${LOCAL_TAG_EXISTS}" -eq 0 ]]; then
    echo "Creating signed tag ${TAG_NAME} at ${release_ref}..."
    git tag -s "${TAG_NAME}" -m "${RELEASE_NAME}" "${release_ref}"
    git tag -v "${TAG_NAME}" >/dev/null
    LOCAL_TAG_CREATED=1
  else
    echo "Using existing local tag ${TAG_NAME} at ${release_ref}."
  fi

  if [[ "${REMOTE_TAG_EXISTS}" -eq 0 ]]; then
    echo "Pushing tag ${TAG_NAME}..."
    if ! git push "${REMOTE}" "${TAG_NAME}"; then
      if [[ "${LOCAL_TAG_CREATED}" -eq 1 ]]; then
        git tag -d "${TAG_NAME}" >/dev/null
      fi
      echo "error: failed to push ${TAG_NAME}; repository rules may restrict tag creation." >&2
      exit 1
    fi
  else
    echo "Using existing remote tag ${TAG_NAME} at ${release_ref}."
  fi
}

ensure_release_does_not_exist() {
  if api_curl "${API_ROOT}/repos/${OWNER}/${REPO}/releases/tags/${TAG_NAME}" >/tmp/rudolph-existing-release.json 2>/dev/null; then
    existing_release_url="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["html_url"])' </tmp/rudolph-existing-release.json)"
    echo "error: release ${TAG_NAME} already exists: ${existing_release_url}" >&2
    echo "Bump VERSION and package.json, then release a new tag." >&2
    exit 1
  fi
}

package_extension() {
  echo "Packaging ${APP_NAME} ${VERSION}..."
  "${ROOT_DIR}/package.sh"

  if [[ ! -f "${ZIP_PATH}" ]]; then
    echo "error: expected package asset was not created: ${ZIP_PATH}" >&2
    exit 1
  fi
}

create_release_payload() {
  python3 - "${TAG_NAME}" "${RELEASE_NAME}" <<'PY'
import json
import sys

tag_name = sys.argv[1]
release_name = sys.argv[2]
print(json.dumps({
    "tag_name": tag_name,
    "name": release_name,
    "draft": True,
    "prerelease": False,
    "generate_release_notes": True,
}))
PY
}

upload_asset() {
  local path="$1"
  local content_type="$2"
  local name
  local encoded_name

  name="$(basename "${path}")"
  encoded_name="$(python3 - "${name}" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1]))
PY
)"

  echo "Uploading ${name}..."
  api_curl \
    -X POST \
    -H "Content-Type: ${content_type}" \
    --data-binary @"${path}" \
    "${upload_url}?name=${encoded_name}" >/dev/null
}

create_github_release() {
  local release_payload
  local release_response
  local publish_payload
  release_payload="$(create_release_payload)"

  echo "Creating draft GitHub release ${TAG_NAME}..."
  release_response="$(api_curl \
    -X POST \
    -H "Content-Type: application/json" \
    "${API_ROOT}/repos/${OWNER}/${REPO}/releases" \
    -d "${release_payload}")"

  CREATED_DRAFT_RELEASE_ID="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])' <<<"${release_response}")"
  upload_url="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["upload_url"].split("{", 1)[0])' <<<"${release_response}")"

  upload_asset "${ZIP_PATH}" "application/zip"

  publish_payload="$(python3 - <<'PY'
import json

print(json.dumps({
    "draft": False,
}))
PY
)"

  echo "Publishing GitHub release ${TAG_NAME}..."
  api_curl \
    -X PATCH \
    -H "Content-Type: application/json" \
    "${API_ROOT}/repos/${OWNER}/${REPO}/releases/${CREATED_DRAFT_RELEASE_ID}" \
    -d "${publish_payload}" >/dev/null
  RELEASE_PUBLISHED=1
}

require_command curl
require_command git
require_command python3

read_version
resolve_repository
resolve_default_branch
ensure_release_branch

if [[ "${DRY_RUN}" -eq 0 ]]; then
  trap cleanup_draft_release EXIT
  ensure_clean_worktree
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "error: GITHUB_TOKEN is required to create the GitHub release and upload assets" >&2
    exit 1
  fi
  sync_release_ref
  check_existing_tags
  create_and_push_tag
  ensure_release_does_not_exist
else
  prepare_dry_run_ref
fi

package_extension

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "Dry run complete:"
  echo "  tag: ${TAG_NAME}"
  echo "  repo: ${OWNER}/${REPO}"
  echo "  release ref: ${release_ref}"
  echo "  asset: ${ZIP_PATH}"
  exit 0
fi

create_github_release

echo "Released ${TAG_NAME}: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG_NAME}"
