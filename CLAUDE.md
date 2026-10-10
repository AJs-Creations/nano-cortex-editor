# Nano Cortex Editor

Desktop editor for the Neural DSP Nano Cortex (Electron edition). Unofficial. Repo: <https://github.com/AJs-Creations/nano-cortex-editor> (MIT, © AJs Creations); builds are published as GitHub Releases (`.github/workflows/release.yml`, on `v*` tags, notes from `CHANGELOG.md`) for macOS and Windows. Never ship anything that could be mistaken for a Neural DSP product: no Neural DSP logos, no screenshots of the Cortex Cloud website, and keep the trademark note in the README and `docs/MANUAL.md`.

User docs: `README.md`, `docs/MANUAL.md` (screenshots from `npm run docs:screenshots`, demo mode). Developer docs index: `docs/README.md`. `CONTRIBUTING.md` has the branch and privacy rules.

**Start with `docs/HANDOFF.md`.** It has the ordered plan. Step 0 is a stack decision for Anup; `docs/INVESTIGATION.md` holds the evidence (Cortex Control teardown, USB findings, community protocol survey).

## Current state

- The app runs as an Electron app with two tabs: the pro editor (`pro/`) and the Cortex Cloud website (their real login, persistent session).
- This repo is the Electron product for good (and the shareable one). The native Mac edition is <https://github.com/AJs-Creations/nano-cortex-editor-mac> (local clone `../nano-cortex-editor-mac`); the two READMEs link each other.
- **No recordings in git, ever** (not even in history): session recordings, `.pklg`/HCI traces and capture bundles stay local (`test/fixtures/sessions/` and those types are git-ignored). Tests inline the specific frames they need with identifying values replaced.
- Hardware-verified on a Nano Cortex (firmware 2.2.1) on 2026-10-08, including Cortex Cloud → pedal capture transfer. `npm run test:ux` passes 474/474 on macOS with demo data (CI, `.github/workflows/ci.yml`, on PRs to `staging`/`main`: a required smoke job and the UX test, also required; the test waits on conditions, not fixed sleeps, so it holds on GitHub's slow macOS runners). Windows is untested.
- Inside VS Code's terminal `ELECTRON_RUN_AS_NODE=1` is set, which makes `electron` behave like `node`. The npm scripts clear it; if you run `electron` by hand, prefix `env -u ELECTRON_RUN_AS_NODE`.

## Commands

```bash
npm install
npm start               # regenerates pro/core.js, then launches
npm run test:ux         # input-driven UX test on demo data; screenshots → test-output/
npm run build:core      # regenerate pro/core.js from editor/index.html
npm run build:preview   # single-file browser preview → dist-preview/
npm run dist            # unsigned .dmg (arm64 + x64); must run on macOS
npm run build:icon      # assets/icon.svg → build/icon.icns, build/icon.png, pro/assets/icon-*.png (macOS)
npm run docs:screenshots # regenerate docs/images/ in demo mode (needs Python + Pillow)
```

## Architecture

- `editor/index.html`: the upstream community editor ([DrD85/nano-cortex-editor](https://github.com/DrD85/nano-cortex-editor), MIT; commit in `editor/README.md`), **verbatim**. Don't edit it. It's the protocol reference and the "Classic Editor" fallback (View menu).
- `scripts/build-core.js`: parses the upstream script with acorn and keeps only the declarations reachable from the functions the pro UI calls (`ENTRY`). Upstream UI functions the pro UI replaces (`HOOKS`: `render`, `log`, `toast`, `showSaveResult`, `chooseSlot`, …) become empty stubs. `$()` is patched to return a dummy element for ids the pro page lacks. It fails loudly if upstream renamed anything in `ENTRY`.
- `pro/core.js`: **generated, never hand-edit.** It defines the global `state`, `MSG` (message types), every device write (`setFXParam`, `setAmpKnob`, `savePreset`, `selectPreset`, `renamePresetTo`, `loadLibraryCapture`, …) and the notification parsers (`onC305`, `handleTypedMessage`).
- `pro/links.js`: the one place for outside links (repo, manual, troubleshooting anchor, issues, native edition, Buy Me a Coffee) and the version shown in Settings → About (keep it equal to `package.json`; the UX test checks). Loaded by the page and required by `src/main.js` (Help menu, About panel). Links always open in the default browser (`window.nanoShell.openExternal` → `shell.openExternal`, allowlisted hosts); support stays quiet: no prompts, counters or accent.
- `pro/transfer.js`: capture upload to the pedal (streamed type-13 message, decoded from a phone-app trace; `docs/INVESTIGATION.md` §6). `src/editor-preload.js` is the only bridge into the editor page: it delivers capture bundles fetched by `src/main.js` with the Cloud tab's session.
- `pro/ui.js` and `pro/ui.css`: the whole UI. It overrides the hooks on `window`. Demo mode (`?demo`, or no Web Bluetooth) fakes the write characteristic and answers typed requests (preset change, rename, library, slot loads, tuner) through the real parsers, so writes still go through the real packet builders.
- Metronome (N): Simple / Advanced overlay. `metroBarEvents(setup, bar)` in `pro/ui.js` is the pure event generator (the spec for the native port); the scheduler consumes it, trainers apply only at bar starts, sounds go through `soundFor(role)`.
- Settings (⌘,): accent, metronome defaults, reconnect at launch, Developer tools, Activity at launch. Page prefs live in localStorage (`settings.*`, `metronome`); what main needs before the page loads (accent for the Dock icon, the remembered pedal, `devTools` for the menu) is in `userData/settings.json`.
- **Developer tools** (`settings.devTools`, off by default; Settings → General → Advanced): gates Record, the Activity drawer and ⌘L, "Sent: …" in the status bar, Activity at launch, Raw settings and the device/capture hashes (elements with class `dev-only`, hidden unless `body.dev-tools`), plus View → Classic Editor / Reload Current / Developer Tools (`src/menu.js`, rebuilt via `nanoShell.setDevTools`). The UX test turns it on with the real switch near the start. Not gated: the dev remote, the `[editor]` terminal mirror, demo mode.
- Activity log file for everyone: main writes every editor console line to `app.getPath('logs')/activity.log` (`src/activity-log.js`: batched ~1 s, rotates to `activity.1.log` past 2 MB). Help → Show Log File reveals it. `src/accent-icon.js` renders the accent icon. `src/editor-preload.js` exposes `window.nanoShell` for these.
- `src/main.js`: the window, both tabs as `WebContentsView`s, the Bluetooth device picker (Electron has none; see `select-bluetooth-device`), permissions, and the Cortex Cloud session partition (`persist:cortex-cloud`).
- `test/ux-test.js`: drives the UI with real mouse, wheel and key events. It asserts both UI state **and the exact packets sent**. Its check names are effectively the behaviour spec.
- Dev remote for hardware sessions: `NANO_DEV_PORT=4848 npm start`, then `curl -d '<js>' http://127.0.0.1:4848/eval` runs JS in the editor page (`?target=cloud` for the Cloud tab), `/log?since=N` returns the Activity log, `/shot?target=cloud&file=…` screenshots (never put Cloud-tab screenshots in the docs). Localhost only, never in packaged builds.
- Session recording: **Record** in the status bar captures every TX/RX packet with timestamps plus the log, and saves JSON (from source: `test/fixtures/sessions/`, git-ignored; never commit recordings). When run with `npm start`, the editor's Activity log is also mirrored to the terminal as `[editor] …`.

## Protocol essentials

- BLE GATT: services `A002`/`A003`, write characteristic `C304`, notify characteristic `C305`. Typed frames are `[len = frame.length − 2] C0 [protobuf payload] [u32 LE message type]`; `MSG` in core.js names the known types. Older-style frames (state requests, FX/amp writes) have other trailing bytes.
- **Preset switching** is over GATT (`SetPresetSlotsRequest`, type 29, acked with type 30), verified on hardware. No MIDI port is needed.
- **USB is one-way:** the pedal accepts MIDI PC 0–63 and CC 34–43 over USB but sends nothing back. There is no USB editing protocol; Cortex Control does not support the Nano.
- The pedal accepts **one BLE connection**. The Cortex Cloud phone app has to be disconnected.
- Upstream tested against firmware 2.2.1.

## Working rules

- **Backlog**: the shared soft idea list for both editors is `../nano-cortex-editor-mac/BACKLOG.md` (`BACKLOG.md` here points at it). Not a plan; ask at task boundaries whether Anup wants to pick from it.

- **Feature parity with the native app** (`../nano-cortex-editor-mac`): every feature Anup asks for lands in both editors unless it genuinely cannot apply to one; he is still deciding between them. This app's CSS is the visual reference for the native one.

- **Hardware in the loop.** Anup has the pedal. For anything protocol-related, ask him to do the physical step and read the Activity log (⌘L, Developer tools on), rather than guessing byte formats.
- Before the first write to a real pedal, make sure his presets are backed up in the official app.
- Edits are live on the pedal; **Save** (⌘S) commits them to the preset. Never save without an explicit user action.
- Never send MIDI to a port that isn't the Nano.
- Keep demo mode working, and keep `npm run test:ux` green. Add checks for new behaviour.
- If the UX test fails on the Mac, fix the harness before suspecting the app, and confirm by hand.
