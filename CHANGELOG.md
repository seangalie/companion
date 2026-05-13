# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-05-13

### Added

- `companion.sh` script that runs macOS update tasks in sequence:
  - `sudo softwareupdate -i -a`
  - `npm update -g` (skipped when npm is not installed)
  - `brew update`
  - `brew upgrade`
  - `brew cleanup`
- README section documenting what the script does, its requirements, and how
  to run it.
