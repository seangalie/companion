# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-04-21

### Fixed

- Stopped the task details panel from showing the unavailable-task warning on every queue item after you attempted to toggle one unavailable task.
- Fixed the full-screen system details overlay so its footer no longer collides with the bottom border and the right border renders correctly.

### Changed

- Removed the `mas upgrade` step from the default catalog, help text, and README for this release while the App Store credential flow is redesigned.
- Returned the TUI to the standard three-pane interface for all update steps by removing the unfinished interactive prompt overlay path.

## [0.1.1] - 2026-04-21

### Added

- Added a running activity indicator in the live output panel so long-running commands continue to show motion and elapsed time even when they are temporarily silent.

### Changed

- Added a Docker daemon availability check so container image refresh only becomes runnable when the Docker CLI is present and the engine is actually running.

## [0.1.0] - 2026-04-21

### Added

- Built Companion as a Node.js and TypeScript terminal app with a Blessed-based TUI and npm-ready package metadata.
- Added a selectable update queue for MacOS software updates, Homebrew packages, npm, pipx, Rust, Composer, and Docker image refresh tasks.
- Added plain command modes for `--auto`, category-based task execution, `--list-tasks`, and version/help output.
- Added a live system snapshot plus an optional full-screen `fastfetch` overlay inside the TUI.
