#!/usr/bin/env bash

# companion.sh — macOS update companion
# Runs a set of common update tasks for macOS in sequence.

set -u

VERSION="1.0.3"

if [ "$(uname -s)" != "Darwin" ]; then
    printf "companion.sh only runs on macOS (detected: %s)\n" "$(uname -s)" >&2
    exit 1
fi

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
  companion.sh              Run all update tasks
  companion.sh --install    Install a copy to ${INSTALL_DIR}/${INSTALL_NAME}
  companion.sh --uninstall  Remove ${INSTALL_DIR}/${INSTALL_NAME}
  companion.sh --help       Show this help

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

uninstall_self() {
    local dest="${INSTALL_DIR}/${INSTALL_NAME}"

    if [ ! -e "${dest}" ]; then
        warn "Nothing to uninstall: ${dest} does not exist"
        return 0
    fi

    printf "Remove %s? [y/N] " "${dest}"
    local reply
    read -r reply
    case "${reply}" in
        y|Y|yes|YES)
            rm -f "${dest}"
            step "Removed ${dest}"
            ;;
        *)
            printf "Uninstall cancelled.\n"
            ;;
    esac
}

case "${1:-}" in
    --install)
        install_self
        exit 0
        ;;
    --uninstall)
        uninstall_self
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

if command -v mas >/dev/null 2>&1; then
    run_step "Updating Mac App Store apps" \
        mas upgrade || true
else
    warn "mas not found — skipping Mac App Store update"
fi

if command -v mise >/dev/null 2>&1; then
    run_step "Upgrading mise-managed tools" \
        mise upgrade || true
else
    warn "mise not found — skipping mise upgrade"
fi

if command -v npm >/dev/null 2>&1; then
    run_step "Updating global npm packages" \
        npm update -g || true
else
    warn "npm not found — skipping global npm update"
fi

if command -v pipx >/dev/null 2>&1; then
    run_step "Upgrading pipx packages" \
        pipx upgrade-all || true
else
    warn "pipx not found — skipping pipx upgrade"
fi

if command -v uv >/dev/null 2>&1; then
    run_step "Upgrading uv-installed tools" \
        uv tool upgrade --all || true
else
    warn "uv not found — skipping uv tool upgrade"
fi

if command -v rustup >/dev/null 2>&1; then
    run_step "Updating Rust toolchains" \
        rustup update || true
else
    warn "rustup not found — skipping Rust toolchain update"
fi

if command -v cargo-install-update >/dev/null 2>&1; then
    run_step "Updating cargo-installed binaries" \
        cargo install-update -a || true
else
    warn "cargo-install-update not found — skipping cargo binary updates"
fi

if command -v composer >/dev/null 2>&1; then
    run_step "Updating global Composer packages" \
        composer global update || true
else
    warn "composer not found — skipping Composer global update"
fi

if command -v gh >/dev/null 2>&1; then
    run_step "Upgrading gh CLI extensions" \
        gh extension upgrade --all || true
else
    warn "gh not found — skipping gh extension upgrade"
fi

if command -v brew >/dev/null 2>&1; then
    run_step "Updating Homebrew" brew update || true
    run_step "Upgrading Homebrew packages" brew upgrade || true
    run_step "Cleaning up Homebrew" brew cleanup || true
else
    warn "brew not found — skipping Homebrew tasks"
fi

step "All tasks have successfully completed."
