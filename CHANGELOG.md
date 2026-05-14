# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-05-14

### Added

- Additional update tasks, each gated on the underlying command being
  installed and skipped with a warning when it is not:
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
