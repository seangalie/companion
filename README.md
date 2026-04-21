# Companion

Companion is a small macOS update console that packages a regular maintenance
flow into a cleaner, shareable Node.js-powered command.

---

## What It Runs

The default queue mirrors some common maintenance commands:

- `softwareupdate -i -a`
- `mas upgrade`
- `brew update`
- `brew upgrade`
- `brew cleanup`
- `npm update -g`
- `pipx upgrade-all`
- `rustup update`
- `cargo install-update -a`
- `composer global update`
- individual `docker` container updates

The TUI adds a live system snapshot, selectable tasks, a running log, and a
live activity indicator so you can see each step without keeping a long shell
one-liner around. Press `f` inside the console to open a full-screen system
details view powered by `fastfetch`.

## Install

```zsh
npm i -g @seangalie/companion
```

If you wish to install directly from GitHub:

```zsh
npm install -g github:seangalie/companion
```

If you wish to clone the repository and build it locally:

```zsh
git clone https://github.com/seangalie/companion.git
cd companion
npm install
npm run build
npm link
```

## Usage

```zsh
companion
companion -h --help         # Display CLI usage help
companion -v --version      # Display console version
companion -a --auto         # Run entire task catalog
companion -u --update       # Run software update and app store upgrade tasks
companion -b --brew         # Run brew update, upgrade, and cleanup tasks
companion -n --npm          # Run npm update tasks
companion -r --rust         # Run rustup update tasks
companion -c --composer     # Run composer update tasks
companion -d --docker       # Run docker container updates
companion -l --list-tasks
```

## Notes

- Some update commands may require elevated privileges depending on the machine state and the packages being updated.
- `companion --auto` is useful when you want the same task catalog without the TUI.
- Unavailable tools such as `brew`, `npm`, or `mas` are detected and clearly marked in the interface.
- In the TUI, commands that prompt for credentials are surfaced through an in-app input modal so the interface stays visible. In plain CLI mode, those commands use the foreground terminal.
- `fastfetch` is optional. If it is installed, press `f` in the TUI to open a full-screen hardware and system details view.
- The Docker task refreshes images for currently running containers and reports that those containers should be recreated if the pulled image changed.
- Docker refresh is only available when the Docker CLI is installed and the Docker daemon is running.

## License

Licensed under [the Apache License, Version 2.0](https://choosealicense.com/licenses/apache-2.0/).
