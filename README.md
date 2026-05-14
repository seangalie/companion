# macOS Companion

A terminal-based macOS update console.

`companion.sh` runs a sequence of common update tasks for macOS so they can be
kicked off with a single command.

## What it does

The script runs the following tasks in order:

1. `sudo softwareupdate -i -a` — install all available macOS software updates
2. `npm update -g` — update globally installed npm packages
3. `pipx upgrade-all` — upgrade all pipx-managed Python applications
4. `rustup update` — update installed Rust toolchains
5. `cargo install-update -a` — update all cargo-installed binaries (requires
   the [`cargo-update`](https://crates.io/crates/cargo-update) crate)
6. `composer global update` — update globally installed Composer packages
7. `brew update` — refresh the local Homebrew formula and cask index
8. `brew upgrade` — upgrade outdated Homebrew packages
9. `brew cleanup` — remove outdated Homebrew downloads and stale versions

Steps that depend on a missing tool are skipped with a warning. Each step
prints a clearly labeled header so progress is easy to follow.

## Requirements

- macOS with the built-in `softwareupdate` command
- `sudo` access for `softwareupdate`
- All other tools are optional — their steps are skipped when the command
  is not on `PATH`:
  - [Homebrew](https://brew.sh) for the `brew` steps
  - Node.js / npm for `npm update -g`
  - [pipx](https://pipx.pypa.io) for `pipx upgrade-all`
  - [rustup](https://rustup.rs) for `rustup update`
  - [`cargo-update`](https://crates.io/crates/cargo-update) for
    `cargo install-update -a`
  - [Composer](https://getcomposer.org) for `composer global update`

## Usage

From the repository directory:

```sh
./companion.sh
```

The script will prompt for your password when `sudo softwareupdate` runs.

### Installing to your PATH

To run `companion` from anywhere, install a copy to your local `bin`
directory:

```sh
./companion.sh --install
```

By default this copies the script to `~/.local/bin/companion`. If that
directory is not already on your `PATH`, the installer prints the line to
add to your shell profile.

Override the destination with the `COMPANION_INSTALL_DIR` environment
variable:

```sh
COMPANION_INSTALL_DIR=/usr/local/bin ./companion.sh --install
```

To remove an installed copy, run:

```sh
companion --uninstall
```

The uninstaller prompts for confirmation before deleting the file. It
honours the same `COMPANION_INSTALL_DIR` override as `--install`.

Run `./companion.sh --help` for a full list of options.

### Installing via npm

The repository also ships with a `package.json` so it can be installed as
a global npm package, which exposes `companion` on your `PATH`:

```sh
npm install -g companion
```

Or directly from the repository:

```sh
npm install -g git+https://code.galie.io/seangalie/companion.git
```

The package is marked `"os": ["darwin"]`, so npm will refuse to install it
on non-macOS systems.

## Versioning

See [CHANGELOG.md](CHANGELOG.md) for release history. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).
