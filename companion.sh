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

INSTALL_DIR="${COMPANION_INSTALL_DIR:-$HOME/.local/bin}"
INSTALL_NAME="companion"

usage() {
    cat <<EOF
macOS Companion v${VERSION}

Usage:
  companion.sh            Run all update tasks
  companion.sh --install  Install a copy to ${INSTALL_DIR}/${INSTALL_NAME}
  companion.sh --help     Show this help

Environment:
  COMPANION_INSTALL_DIR   Override the install directory (default: ~/.local/bin)
EOF
}

install_self() {
    local src
    src="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    local dest="${INSTALL_DIR}/${INSTALL_NAME}"

    step "Installing ${INSTALL_NAME} to ${dest}"

    mkdir -p "${INSTALL_DIR}"
    cp "${src}" "${dest}"
    chmod +x "${dest}"

    printf "Installed: %s\n" "${dest}"

    case ":${PATH}:" in
        *":${INSTALL_DIR}:"*)
            printf "%s is already on your PATH — run '%s' from anywhere.\n" \
                "${INSTALL_DIR}" "${INSTALL_NAME}"
            ;;
        *)
            warn "${INSTALL_DIR} is not on your PATH"
            printf "Add it by appending this to your shell profile:\n\n  export PATH=\"%s:\$PATH\"\n" \
                "${INSTALL_DIR}"
            ;;
    esac
}

case "${1:-}" in
    --install)
        install_self
        exit 0
        ;;
    -h|--help)
        usage
        exit 0
        ;;
    "")
        ;;
    *)
        fail "Unknown option: $1"
        usage
        exit 2
        ;;
esac

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
