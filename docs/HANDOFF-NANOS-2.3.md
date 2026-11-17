# Handoff: NanOS 2.3.0 support (both editors)

Written 2026-11-17 by the previous leader session. Read this first, then `CLAUDE.md`.

## Goal

Anup's Nano Cortex is now on **NanOS 2.3.0**. Support it in **both** editors and release them together (parity and
matching versions are standing rules):

- Electron: `AJs-Creations/nano-cortex-editor`, clone `~/DevProjects/mac_projects/nano-cortex-editor`
- Native SwiftUI: `AJs-Creations/nano-cortex-editor-mac`, clone `~/DevProjects/mac_projects/nano-cortex-editor-mac`

Both are released at **1.2.3**; `main` == `staging` in both; only `main`, `staging` (and local `feature/mcp`) exist.

## Anup's decisions (2026-11-15), in his words where it matters

- **Method is ours to choose**: "we don't need to sync. Take what is necessary… If syncing is the best and easiest
  option that does not break any of our functionality, go ahead… I want it to support the newest firmware as best as
  it can as well as perform well and be stable." Grab upstream improvements we judge useful.
- **Curves**: where #31's fitted curves and upstream's scaling disagree, **measure on his pedal** (he has it, on 2.3.0).
- **Pedal tempo/metronome (2.3.0)**: "integrate what the pedal supports into our app natively. Anything extra keep
  separate but still keep functionality in the app. Let me know if there are any conflicts or decisions to be made."
  Our computer-side metronome (N, Simple/Advanced, trainers) is a superset; the pedal's own tempo/metronome becomes
  native, our extras stay.

## Done (branch `feature/nanos-2.3`, Electron, worktree `.claude/worktrees/nanos23`, not pushed to a PR yet)

1. **Upstream synced to V1.18.0** (`cf3f143`, the latest upstream *release*; upstream main is at an unreleased
   1.19.0, skip it). `editor/index.html` is byte-identical to V1.18.0; `editor/README.md` updated.
2. **#31 patch re-ported** (`editor/patches/0001-fx-parameter-mappings.patch`, via `git merge-file`; 5 conflicts):
   - upstream's `travelToShare` / `shareToTravel` now use **#31's curve where it has one** (`normalizedReversePower`,
     `normalizedPower`), **upstream's `PARAM_SKEW` otherwise**: today's shipped behaviour is unchanged until measured;
   - upstream's "the Nano did not take <model>" check kept together with our preset-change reset rule;
   - Cab/IR drag uses upstream's `knobDrag` with #31's cab curve; MIDI path keeps `normalizedToParamValue`.
3. **`scripts/build-core.js`**: new `DISABLED` map stubs **`knownNano`** (upstream V1.17+ connects the last device via
   `navigator.bluetooth.getDevices()`, bypassing our picker / remembered pedal in `src/bt-picker.js`, with a 2.5 s
   wait). Upstream's auto-reconnect (`autoLink`) is inert in our app: it needs `window.nanoWindow.autoConnect`,
   which we don't define. Keep it that way.
4. **Tested firmware → 2.3.0** (`COMPAT.testedFirmware` and demo default in `pro/ui.js`); the newer-firmware tests now
   use 2.4.0.
5. **New UX checks** (section "NanOS 2.3.0" in `test/ux-test.js`): the five effects listed in the right slots and
   categories, reverb colour, skew vs #31 precedence, inverse curves, `knownNano` disabled, picking Poly Octaver writes
   it and the demo pedal takes it.
6. **`npm run test:ux`: 887/887 on macOS.** (The "waited 5000 ms in vain … txSince(n0)" line is pre-existing.)

`pro/core.js` grew 219 → 366 KB: changed upstream functions we call (`onC305`, `handleTypedMessage`,
`connectAll`, `writeC304`, `parseBufferedCurrentState`, …) now reach upstream's controller, capture, audition, metro
and library code. Reviewed: those paths stay dormant unless their feature is used (controller connection, capture
mode, auditions, type 145). Useful upstream fixes that come along: preset-change re-read 450 → 250 ms, library read
retries / re-read on reconnect, cab-mic "did it take" re-reads, model-not-taken toast.

## What NanOS 2.3.0 adds (from upstream, V1.14.0 – V1.18.0)

- **Five effects**: Poly Octaver, Wham, Chief OC2 (Pre FX, `Pitch`), Blossom (ST), Shimmer (Post FX 3, `Reverb`).
  Older firmware just doesn't load them. Our category colours already cover both.
- **Scaling** (`PARAM_SKEW`, 85 params, from the Quad Cortex definitions): `share = travel^(1/skew)`.
- **Tempo/metronome** (upstream commit `e21b78b`): state fields **24** firmware string, **55** tempoIsGlobal,
  **56** tempo (float32), **61** externalMidiClockRunning; **TempoScreenMessage type 145** sent whole on open and every
  change, `tempoScreenActive false` on close; a 145 from the Nano opens/closes it and carries its metronome settings
  (tempo, tap, volume −60…+9 dB, time signature, note, sound). Upstream code: `metro`, `tempoFrame`, `metroSend`,
  `handleTempoScreen`, `METRO_*` in `pro/core.js` (already reachable, unused by our UI).

## Next steps, in order

| # | Step | Model | Verify |
|---|---|---|---|
| 1 | Branch is pushed (no PR yet); open the PR → `staging` only after step 2 passes on hardware | Opus | CI green (incl. `build-core-windows`) |
| 2 | 👤 **Hardware smoke on 2.3.0** with Anup: connect, preset switch, load each of the 5 new effects, edit a knob, footswitch on/off, library, cab mic. Use the dev remote (`NANO_DEV_PORT=4848 npm start`, `/eval`, `/log`). Never Save without his explicit action. | Opus | Activity log clean; no "did not take" surprises |
| 3 | 👤 **Curve measurement**: controls where #31 and upstream disagree (list them: e.g. delay/reverb High/Low Pass, Low-High Cut HPF/LPF, Tremolo Rate is upstream-only). Anup sets known values in the phone app; read what the editor shows; pick the closer curve **per control**; encode in the patch; add checks | Opus | UX checks name the measured values |
| 4 | **Pedal tempo design**: read upstream's metro code + our metronome (`metroBarEvents`, Simple/Advanced). Write the conflicts for Anup (e.g. one BPM or two? click on pedal vs computer? global vs preset tempo? MIDI clock running = read-only?) and **ask before building** | Opus | Anup's answers recorded in `DECISIONS`/`PLAN` |
| 5 | Build pedal tempo in Electron + checks (demo must answer 145 and fields 55/56) | Opus | test:ux green |
| 6 | **Native port** (`nano-cortex-editor-mac`): `scripts/gen-models.js` regenerates `Models.swift` from Electron's `core.js` (5 effects); port skew + precedence into `FXValues.swift`; tested firmware 2.3.0; pedal tempo; tests (FXMappingTests etc.) | Opus (or a worker) | `xcodebuild test` green; native peek (snapshot/restore `com.community.nanocortex` defaults + trim `activity.log`) |
| 7 | Release both as one version (1.3.0 if tempo is in, else 1.2.4 – ask Anup; 1.3.0 was earmarked for MCP), CHANGELOGs, READMEs ("Tested with firmware 2.3.0") | Opus | downloads verified: notarised, version, appcast, `latest-mac.yml`, Windows build |

## Rules that bite (also in CLAUDE.md / memory)

- `editor/index.html` stays **verbatim upstream**; local fixes go in `editor/patches/*.patch` only.
- No direct pushes to `main`/`staging`; feature branch → PR to `staging` → staging→`main` PR → lightweight tag
  `vX.Y.Z` on main. Repos auto-delete merged branches now. Never `--no-verify`.
- Never save, rename, load or delete on the pedal without Anup's explicit action. Never kill his installed app
  (`/Applications/Nano Cortex Editor.app`).
- Never commit traces or private recordings; never ship Neural DSP logos. Upstream's `MODEL_IMAGES` paths (pedal
  photos) are not shipped by us; keep it that way.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR footer
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- In this zsh, word lists don't split: run multi-word loops under `bash <<'EOF'`.
