# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-05-14

### Added

- Docker container image update task, run after the Homebrew steps.
  When [Docker](https://www.docker.com) is installed and its daemon is
  responsive, `docker pull` is run for each tagged image known to the
  local daemon so containers can be recreated from the latest images.
  The step is skipped with a warning when Docker is not installed or
  the daemon is not running. Docker Desktop itself continues to be
  updated through the existing Homebrew cask upgrade step.

## [1.0.3] - 2026-05-14

### Added

- Three more update tasks, each gated on the underlying command being
  installed and skipped with a warning when it is not:
  - `mise upgrade` — upgrade tools managed by
    [mise](https://mise.jdx.dev)
  - `uv tool upgrade --all` — upgrade tools installed via
    [uv](https://docs.astral.sh/uv/)
  - `gh extension upgrade --all` — upgrade installed GitHub CLI extensions

### Changed

- Step headers are now preceded by a dim, terminal-width horizontal rule so
  each task is easier to spot when scrolling back through output.
- Failure messages are preceded by a red horizontal rule and printed in
  bold red so errors stand out from surrounding command output.
- "Tool not found" skip messages are preceded by a yellow horizontal rule
  and printed in bold yellow, matching the step and failure formatting.

## [1.0.2] - 2026-05-13

### Added

- Additional update tasks, each gated on the underlying command being
  installed and skipped with a warning when it is not:
  - `mas upgrade` (Mac App Store apps, via the [`mas`](https://github.com/mas-cli/mas) CLI)
  - `pipx upgrade-all`
  - `rustup update`
  - `cargo install-update -a` (from the `cargo-update` crate)
  - `composer global update`

## [1.0.1] - 2026-05-13

### Added

- `companion.sh` script that runs macOS update tasks in sequence:
  - `sudo softwareupdate -i -a`
  - `npm update -g` (skipped when npm is not installed)
  - `brew update`
  - `brew upgrade`
  - `brew cleanup`
- `--install` option that copies the script to `~/.local/bin/companion` (or
  the directory set via `COMPANION_INSTALL_DIR`) and warns if the install
  directory is not on `PATH`.
- `--uninstall` option that removes the installed copy after a `[y/N]`
  confirmation prompt.
- `--help` / `-h` option that prints usage information.
- macOS check at startup that exits with an error on non-Darwin systems.
- `package.json` so the script can be distributed as a global npm package
  (`npm install -g macos-companion`), with `"os": ["darwin"]` to block
  non-macOS installs and a `bin` entry that exposes `companion` on `PATH`.
- README section documenting what the script does, its requirements, and how
  to run and install it.
