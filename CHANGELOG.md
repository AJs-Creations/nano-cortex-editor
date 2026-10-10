# Changelog

All notable changes to Nano Cortex Editor (Electron edition). Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-10-10

First public release.

### Help, About and support links

- Settings → About (version, links to the repository, the manual and the native macOS edition), a Help menu (Manual,
  GitHub Repository, Report an Issue, Support the Project…), links to the manual on the connect screen, in the
  shortcuts sheet and in connection errors, and a quiet "♥ Support" link in the status bar. Every link opens in
  your browser.
- Settings → General → Advanced → **Developer tools** (off by default). It shows the Activity log, session recording
  and protocol details: Record and Activity in the status bar, ⌘L, the "Sent: …" status text, Activity at launch,
  Raw settings and the device and capture hashes, and View → Classic Editor, Reload Current and Developer Tools.
  Everything appears and disappears at once when you flip it; turning it off stops a recording in progress (saving
  it to the recordings folder) and closes the Activity drawer.
- **Help → Show Log File**, for everyone: the Activity log is also written to `nano-cortex-editor.log` in the app's logs folder
  (the last ~2 MB plus one older file). The bug report template asks for it.

### Features

- Bluetooth connection to the Nano Cortex with automatic pedal selection, reconnect at launch and a demo mode that
  runs everything on sample data.
- Preset browser for all 64 presets: filter, keyboard navigation, right-click menus, and a prompt before switching
  away from unsaved edits.
- Save, Save as… (into any slot), Rename, Delete and Discard.
- Editing of every block: gate, Pre FX 1–2, capture (amp knobs and capture volume), Cab / IR (level, filters,
  microphone and position) and Post FX 1–3, with a searchable effect picker and keyboard shortcuts.
- Captures and IRs from the pedal's library into any slot, with capture-kind and instrument icons, capture Info…
  and a slot usage scan; presets that play a capture or cab straight from the library are shown as such.
- Footswitch assignment (IA, IB, IIA, IIB) from the Footswitches strip or the preset menu.
- Expression pedal assignments per preset: sweeps and block switches with all their options.
- Preset tempo with − / +, typing, scrubbing and Tap.
- Tuner with reference pitch and mute.
- Metronome with Simple and Advanced modes: patterns, accents, subdivisions and swing, count-in, tempo trainer, gap
  trainer, Levels, five click sounds, output selection, and an option to follow the preset tempo.
- Settings: accent colour (the app icon follows), metronome defaults, connection options, and a Device page with the
  pedal's details, LED brightness and USB playback volume.
- Cortex Cloud tab with your own login and Send to Nano Cortex for captures.
- Activity log and session recording of all Bluetooth traffic.
- The original community editor by DrD85 as View → Classic Editor.
- Unsigned builds for macOS (Apple Silicon and Intel, .dmg and .zip) and Windows (installer and portable).

### Known limitations

- The Windows build has not been tested with a pedal yet.
- Some features have been verified only against recorded phone-app traffic and in demo mode, not yet end to end on a
  pedal from this app: footswitch assignment, expression assignments (including whether Save keeps them), preset
  tempo, the Device settings page, reconnect at launch and the slot usage scan.
- IRs and presets from Cortex Cloud still need the official app; only captures can be sent.
- Preset reordering and copying (other than Save as…) are not supported yet.
- Cab tone knobs for a cab played straight from the library are not read back.
- Tested with firmware 2.2.1 only.
