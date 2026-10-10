# Nano Cortex Editor

An unofficial desktop editor for the Neural DSP Nano Cortex, for macOS and Windows. It connects to the pedal over
Bluetooth and gives you a full-size editor: browse and manage your 64 presets, edit every block in the signal chain,
load captures and IRs from the pedal's library, set up footswitches and the expression pedal, and tune or practise
with the built-in tuner and metronome. A second tab opens the Cortex Cloud website, where you sign in with your own
account and send captures straight to the pedal. Free and open source (MIT). No pedal handy? Demo mode runs the
whole editor on sample data.

![The editor in demo mode: the Editor and Cortex Cloud tabs at the top, the preset list on the left, the signal chain across the top and the capture's amp knobs and slots below](docs/images/hero.png)

> **Unofficial.** Neural DSP and Nano Cortex are trademarks of Neural DSP Technologies Oy; this project is not
> affiliated with or endorsed by Neural DSP.

## Features

- **Preset browser**: all 64 presets with a filter, keyboard navigation and right-click menus. Switching with
  unsaved edits asks first.
- **Signal chain editing of every block**: gate, Pre FX 1–2, capture (amp knobs and capture volume), Cab / IR
  (level, high and low pass, microphone and position) and Post FX 1–3. Pick effects from a searchable list, bypass
  with one key, and every change is live on the pedal.
- **Knobs that behave**: drag or scroll, hold Shift for fine control, double-click to reset, click the value to type
  an exact one.
- **Captures and IRs from the pedal's library** (factory and your own) into any slot, with icons for the capture kind
  (amp head, combo, pedal, preamp, rack, cab…) and instrument; **Info…** shows author, tags and description, and a
  usage scan shows which presets use each slot.
- **Save, Save as…, Rename, Delete and Discard**: edits are live; **Save** (⌘S / Ctrl+S) commits them.
- **Footswitch assignment** for the four 4-Preset-mode slots IA, IB, IIA and IIB.
- **Expression pedal assignments** per preset: sweeps with heel and toe values and invert; block switches with
  heel-toe, switch or stop modes, delay, latch and invert.
- **Preset tempo** with − / +, scrubbing, typing and **Tap**.
- **Tuner** with reference pitch and output mute.
- **Metronome** with **Simple** and **Advanced** modes: time signatures, accents, subdivisions and swing, count-in,
  tempo trainer, gap trainer and **Levels**; it can follow the preset's tempo.
- **Settings** (⌘, / Ctrl+,): accent colour, metronome defaults and click sounds, reconnect at launch, and a
  **Device** page with the pedal's details, LED brightness and USB playback volume.
- **Cortex Cloud tab**: the Cortex Cloud website with your own login; on a capture's page, **Send to Nano Cortex**
  puts it in the pedal's library over Bluetooth.
- **Activity log and session recording** of the Bluetooth traffic, for troubleshooting.
- **Keyboard shortcuts** for everything common (press `?` in the app).
- **Demo mode**: try every feature without a pedal.

## Download

Get the latest build from [GitHub Releases](https://github.com/AJs-Creations/nano-cortex-editor/releases/latest):

| System | File |
|---|---|
| macOS, Apple Silicon (M1 and later) | `nano-cortex-editor-<version>-mac-arm64.dmg` (or `.zip`) |
| macOS, Intel | `nano-cortex-editor-<version>-mac-x64.dmg` (or `.zip`) |
| Windows 10/11, 64-bit | `nano-cortex-editor-<version>-win-x64.exe` (installer) or `…-win-x64-portable.exe` (runs without installing) |

The builds are **not code-signed** (that needs paid developer certificates), so your system warns you the first time:

- **macOS**: open the `.dmg` and drag **Nano Cortex Editor** to Applications. The first time, right-click (or
  Control-click) the app, choose **Open**, then **Open** again. If macOS only offers to move it to the Bin, open
  **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the message about
  Nano Cortex Editor.
- **Windows**: run the installer or the portable `.exe`. When SmartScreen says "Windows protected your PC", click
  **More info → Run anyway**.

## Requirements

- A Nano Cortex. Tested with firmware **2.2.1**.
- Bluetooth Low Energy (Bluetooth 4.0 or later) on your computer.
- macOS 12 Monterey or later, or Windows 10/11 (64-bit). The Windows build has not been tested with a pedal yet;
  please [report](https://github.com/AJs-Creations/nano-cortex-editor/issues) how it goes.
- **The pedal accepts one Bluetooth connection at a time.** Quit the Cortex Cloud app on your phone (or turn off the
  phone's Bluetooth) before you connect.
- **Back up your presets** in the official app before you save anything from here. Saves are permanent.

## Also available: native macOS edition

[Nano Cortex Editor for Mac](https://github.com/AJs-Creations/nano-cortex-editor-mac) is a native SwiftUI version
with the same features and look, plus a menu bar extra. Pick the native edition if you are on macOS 14 or later and
want a smaller, Mac-only app; pick this one for Windows, for macOS 12–13, or to use the same app on both systems.

## Manual

The [user manual](docs/MANUAL.md) walks through installation, connecting, every part of the window, each feature,
the keyboard shortcuts and troubleshooting.

## Build from source

You need [Node.js](https://nodejs.org/) 22 or later.

```bash
npm install
npm start            # run the app from source
npm run test:ux      # automated UX test on demo data (screenshots in test-output/)
npm run dist         # unsigned macOS .dmg/.zip for Apple Silicon and Intel (run on a Mac)
```

Developer and protocol documentation lives in [docs/](docs/README.md); see [CONTRIBUTING.md](CONTRIBUTING.md) to
help out and [CHANGELOG.md](CHANGELOG.md) for what changed.

## Credits

The Bluetooth protocol layer comes from the community
[Nano Cortex Editor by DrD85](https://github.com/DrD85/nano-cortex-editor) (MIT), which builds on
[nano-cortex-web-editor by choldy](https://github.com/choldy/nano-cortex-web-editor) (MIT). DrD85's original
interface is still in the app under **View → Classic Editor**. Thanks to both projects. Full notices:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Trademarks

Neural DSP and Nano Cortex are trademarks of Neural DSP Technologies Oy; this project is not affiliated with or
endorsed by Neural DSP. Quad Cortex, Neural Capture and Cortex Cloud are Neural DSP trademarks too, named here only to
describe compatibility. This is an independent tool; use it at your own risk.

## License

[MIT](LICENSE) © 2026 AJs Creations.
