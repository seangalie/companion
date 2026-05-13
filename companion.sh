#!/usr/bin/env bash

# companion.sh — macOS update companion
# Runs a set of common update tasks for macOS in sequence.

set -u

VERSION="1.0.1"

GREEN="$(tput setaf 2 2>/dev/null || true)"
YELLOW="$(tput setaf 3 2>/dev/null || true)"
RED="$(tput setaf 1 2>/dev/null || true)"
BOLD="$(tput bold 2>/dev/null || true)"
RESET="$(tput sgr0 2>/dev/null || true)"

step() {
    printf "\n%s==> %s%s\n" "${BOLD}${GREEN}" "$1" "${RESET}"
}

warn() {
    printf "%s!! %s%s\n" "${YELLOW}" "$1" "${RESET}"
}

fail() {
    printf "%sxx %s%s\n" "${RED}" "$1" "${RESET}"
}

run_step() {
    local label="$1"
    shift
    step "$label"
    if "$@"; then
        return 0
    else
        local code=$?
        fail "$label failed (exit $code)"
        return $code
    fi
}

printf "%smacOS Companion v%s%s\n" "${BOLD}" "${VERSION}" "${RESET}"

run_step "Installing macOS software updates" \
    sudo softwareupdate -i -a || true

if command -v npm >/dev/null 2>&1; then
    run_step "Updating global npm packages" \
        npm update -g || true
else
    warn "npm not found — skipping global npm update"
fi

if command -v brew >/dev/null 2>&1; then
    run_step "Updating Homebrew" brew update || true
    run_step "Upgrading Homebrew packages" brew upgrade || true
    run_step "Cleaning up Homebrew" brew cleanup || true
else
    warn "brew not found — skipping Homebrew tasks"
fi

step "All tasks have successfully completed."
