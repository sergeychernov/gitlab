#!/usr/bin/env bash
# share/section.sh
#
# Helper for GitLab CI collapsible sections with wall-time measurement for
# each section. Emits exactly the ANSI markers that gitlab-pipeline-stats
# understands (see the --section flag), and that the GitLab UI itself uses
# to render each section as a collapsible block with a duration in job logs.
#
# Usage (after `source`-ing this file):
#
#   section <name> <command...>
#
# For example:
#
#   source node_modules/gitlab-pipeline-stats/share/section.sh
#   section install      yarn install --frozen-lockfile
#   section test         yarn test
#   section gatsby_build yarn build
#
# Inline env vars are supported:
#
#   CI_COMMIT_REF_SLUG=master section upload ./scripts/upload.sh
#
# Section names should be snake_case without spaces (regex: [^[\]\r\n]+) so
# that GitLab identifies the block correctly and --section-filter matches
# them predictably.
#
# Exit codes: section returns the wrapped command's rc — `set -e` in the
# calling script still aborts the job on the first failure.

section() {
    local name="$1"; shift

    local start
    start=$(date +%s)
    printf '\e[0Ksection_start:%s:%s[collapsed=true]\r\e[0K%s\n' "$start" "$name" "$name"

    local rc=0
    "$@" || rc=$?

    local end
    end=$(date +%s)
    printf '\e[0Ksection_end:%s:%s\r\e[0K\n' "$end" "$name"
    printf '⏱  %s: %ds (rc=%d)\n' "$name" "$((end - start))" "$rc"

    return "$rc"
}
