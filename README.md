# macOS Companion

A terminal-based macOS update console.

`companion.sh` runs a sequence of common update tasks for macOS so they can be
kicked off with a single command.

## What it does

The script runs the following tasks in order:

1. `sudo softwareupdate -i -a` — install all available macOS software updates
2. `npm update -g` — update globally installed npm packages (skipped if `npm`
   is not installed)
3. `brew update` — refresh the local Homebrew formula and cask index
4. `brew upgrade` — upgrade outdated Homebrew packages
5. `brew cleanup` — remove outdated Homebrew downloads and stale versions

Steps that depend on a missing tool (`npm` or `brew`) are skipped with a
warning. Each step prints a clearly labeled header so progress is easy to
follow.

## Requirements

- macOS with the built-in `softwareupdate` command
- [Homebrew](https://brew.sh) for the `brew` steps (optional)
- Node.js / npm for the `npm update -g` step (optional)
- `sudo` access for `softwareupdate`

## Usage

From the repository directory:

```sh
./companion.sh
```

The script will prompt for your password when `sudo softwareupdate` runs.

## Versioning

See [CHANGELOG.md](CHANGELOG.md) for release history. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).
