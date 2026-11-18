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

## Step 2 results: hardware smoke on NanOS 2.3.0 (2026-11-17, Anup's pedal, driven over the dev remote)

Driven through the page's own functions (`selectPreset`, `setFXModel`, `setFXParam`, `setCabIRMicPosition`) on presets
63 and 64; the window was hidden, so drawing was paused and no real mouse input was used. Nothing was saved: 63, 64
and 26 reloaded as they were.

- **Connect**: firmware 2.3.0 (no newer-firmware banner), 64 presets, 25 slot captures, 5 slot IRs, library 25 + 7
  captures and 10 + 1 IRs. The state dump carries tempo 120.0 in field 56.
- **Preset switch**: type 29 acked with 30 every time; state and FX parameters re-read.
- **The five effects**: Poly Octaver (`D4 8C 01`), Wham (`D6 8C 01`), Chief OC2 (`DE 8C 01`) in Pre FX 1, Blossom (ST)
  (`DE 3E`) and Shimmer (`CA 3E`) in Post FX 3: the state reports each id back, parameters load, one knob written per
  effect and read back equal.
- **Cab mic / position**: four valid changes on the 412 CA cab, each named back by the state ("cab/mic/position",
  position 0-based). A mic the cab does not offer is ignored by the pedal (the UI never offers one).
- **Finding: the pedal refuses every Pitch effect in Pre FX 2** (Transpose, Poly Octaver, Wham, Chief OC2), whatever
  Pre FX 1 holds (tried with Chief OC2, Transpose and Green 808 there). The editor says "the Nano did not take …" and
  keeps the old effect. Our picker and the UX check "… Pitch effects in Pre FX 1 and 2" still list them in Pre FX 2.
  Open: does the official app offer Pitch in Pre FX 2? If not, hide the category there in both editors.
- **Seen again (DECISIONS #11)**: a mic/position write lands in the cab slot at once, for every preset. The test moved
  cab slot 4 from position 4 to 3; it was put back (preset 63 reports its cab as a library reference again).
- **Not checked**: footswitch bypass following, the sound, real mouse input on the pedal.

### First look at the curves (step 3), from the values the pedal holds for a freshly picked effect on preset 64

Assumption: factory defaults are round numbers. Not a measurement against the official app yet.

- Delays (Analog, Digital, Dual, Tape) High / Low Pass: upstream's skew 0.6 gives 120 Hz and 3000 Hz; #31's curve gives
  33 Hz and 1268 Hz. Dual Reverse: High Pass 80 Hz with skew 0.6; Low Pass 14000 Hz linear (upstream), 10357 with #31.
- Low-High Cut LPF: skew 0.3 gives 13000 Hz, #31 gives 14131.
- Mind Hall: skew 0.5 gives High Pass 200 Hz and Low Pass 3100 Hz; #31 gives 88 Hz and 1600 Hz.
- Ambience, Cave, Hall, Modulated, Room: neither gives round numbers (also not for Decay / Pre Delay, which only
  upstream scales). These need the official app.
- Parametric 3 frequencies: #31 gives 125 / 1000 / 4000 Hz, upstream (linear) 4156 / 8112 / 12328: #31 is right.

### Running the editor from a terminal that is not VS Code

`npm start` from Warp (or any terminal app without a Bluetooth usage string) dies at the first `requestDevice()`:
macOS TCC kills Electron because the terminal is the responsible process. Start it through LaunchServices instead:
`npm run build:core && open -n -a node_modules/electron/dist/Electron.app --env NANO_DEV_PORT=4848 --stdout <log> --stderr <log> --args "$PWD"`.

### Decisions and findings of 2026-11-18

- **Step 3 is closed without a measurement round** (Anup): "it does not matter too much what the value displayed is as
  long as the preset is always going to sound the same when saved." The pedal stores knob travel, so it does. The
  precedence stays as shipped (#31's curve where it has one, upstream's skew otherwise). The eight "Cal 1"–"Cal 8"
  presets (slots 54–61, saved with his permission, names confirmed in the phone app) are still on the pedal; delete
  them only when he says so. The question list is `~/DevProjects/mac_projects/NANOS-2.3-VERIFICATION.md`.
- **Not exercised in the smoke: our tempo field on 2.3.0.** Its frame (type 145 `{3: scope, 4: 0, 5: bpm, 6: 0}`,
  INVESTIGATION §9) is upstream's TempoScreenMessage: 3 = tempoScreenActive, 4 = tempoIsGlobal, 5 = tempo,
  6 = externalMidiClockRunning, and on 2.3.0 also 7 volume, 8 muted, 9 time signature, 10 note, 11 sound. Ours omits
  7–11: if the pedal reads a missing `muted` as false, a tempo change from the editor switches its metronome on at
  0 dB; and `4: 0` may take the pedal out of global tempo (unverified since 2.2.1). Check on hardware with Anup
  listening (1 BPM up and back, no Save, read the pedal's 145) before any release, in both editors (same frames,
  `TempoTests.swift`).
- **Tempo field checked on the pedal (2026-11-17 evening, preset 54, nothing saved)** with the frames 1.2.3 ships:
  live `{3:1 4:0 5:bpm 6:0}` sets the tempo (state field 56 follows) and marks the preset edited at once (on 2.2.1
  only the `3:0` write did); the `3:0` commit changes nothing more; writing the stored value back clears "edited".
  The pedal answers `{1:1 3:1 5:bpm}` only to the first `3:1` after a `3:0` (the "screen" opening), with the tempo
  it had before that write, and never includes fields 7–11. So the field works on 2.3.0; whether the omitted
  metronome fields switch the click on could not be read back (ask Anup if the pedal clicked, or look at the app's
  Tempo screen). `tempoIsGlobal` was false, so the `4:0` question is still open.
- **Native UI smoke** (`NanoCortexEditorUITests`, demo mode) passes 7/7 on the port; the seven `NSWindow Frame` keys
  it added to `com.community.nanocortex` were deleted and `activity.log` trimmed back.
- **Official notes** (neuraldsp.com, 2026-11-11): the five effects; a metronome in the redesigned Tempo menu of the app
  (volume, sounds, time signatures, subdivisions; keeps playing across preset changes and after closing the menu);
  unnamed bug fixes. Nothing else to support.
- **Native port started** in `nano-cortex-editor-mac/.claude/worktrees/nanos23` (branch `feature/nanos-2.3` from
  `origin/staging`, uncommitted): effects, scaling precedence, tested firmware. Tempo and the Pre FX 2 picker wait
  for Anup's answers.

## App measurements (2026-11-17 late evening): the official app, read through iPhone Mirroring

Method: the eight "Cal" presets (slots 54–61, knobs at known travel) opened one by one in Cortex Cloud on Anup's
phone, mirrored to the Mac; every effect screen captured and read (screen capture + Vision text recognition, taps and
scrolls as synthetic input; Warp needs Screen Recording and Accessibility). Nothing was saved or changed in the app.
All 149 values are in `~/DevProjects/mac_projects/NANOS-2.3-VERIFICATION.md` ("Phone app shows").

**Confirmed right**
- The five new effects: every control present under the same name; values equal ours, except Blossom "E.R. Length"
  (app 50 % at travel 0.504: linear; upstream's skew 0.4 gives 18 %).
- Upstream's skew wherever it is the only curve (Tremolo, Utility Gate, all compressors, delay times, mod rates,
  attack / release, Chorus rate, Blossom, Shimmer): the app shows the same numbers to the last digit.
- Pitch is not offered in Pre FX 2 (the list has Utility/EQ, Wah/Filter, Overdrive, Compressor): hide it there.
- Tempo screen: exactly upstream's model (Global/Preset, mute, volume, Blip/Digital, the 21 time signatures,
  1/4 1/8 1/8T 1/16). The metronome was still muted after our tempo writes.

**#31 is wrong where it disagrees with upstream: upstream's skew must win** (app = skew value in every case)
- High Pass / Low Pass of Analog, Digital, Dual, Tape and Dual Reverse (High Pass) Delay, and of Mind Hall;
  Low Pass of Hall, Room, Modulated, Ambience, Cave. E.g. Analog Delay at 0.25: app 99 Hz / 2490 Hz, skew 98.9 / 2488,
  #31 28 / 1148. Tape Delay at 0.5: app 306 / 2438, skew 306 / 2438, #31 151 / 1316.
- Parametric 3 frequencies: #31's 10/3 power (= skew 0.3 over 20–20000 Hz) is right: 217 / 2002 / 7678 Hz.

**Wrong in both sources (older than 2.3.0 support; not fixed yet)**
- **Low-High Cut**: in the app both HPF Freq and LPF Freq run 20–20000 Hz with skew 0.3 (217 / 2017 / 7771 and
  217 / 2002 / 7678 Hz at 0.25 / 0.5 / 0.75). We have 20–800 and 1000–16000 Hz.
- **Classic reverbs (Hall, Room, Cave, Modulated, Ambience): our parameter order is wrong.** The values written to
  our "Decay" and "High Pass" indices showed up under other controls in the app, and the app's Decay / High Pass
  stayed at what look like defaults (4.00 s, 80 Hz). Consistent with a true order of Decay, Mix, (extras), High Pass,
  Low Pass, Pre Delay for Hall / Room / Cave / Modulated (Hall: index 1 at 0.25 → Mix 25 %, index 3 at 0.253 → Low
  Pass 1934 Hz, index 4 at 0.25 → High Pass 97 Hz). Not yet proven per index: needs a sweep with a different travel
  on every index (Ambience is different again). Mind Hall's High / Low Pass indices are right.
- **Envelope Filter**: app ranges are Attack / Decay 10–1000 ms linear, Level −20…+20 dB linear, Freq Depth
  −10000…+10000 Hz linear, Freq 1010 Hz at 0.5 and 118 Hz at 0.25; ours differ (#31 fits). Reso matches.
- Graphic 9 LPF at 0.5: app 6985 Hz, ours 7.62 kHz. Circular Delay High / Low Pass at 0.5: app 4098 / 6416 Hz, ours
  97 Hz / 2.49 kHz (order or range, unknown). Dual Reverse Low Pass not captured.
- Names: the app says "Analog Delay (ST)", "Tape Delay (ST)", "Parametric-3", "Graphic-9".

## Decisions of 2026-11-17 (late) and what the pedal does with tempo on 2.3.0

Anup's decisions (his answers "1 b, 2 a, 3 a, 4 a, 5 a, 6 a", plus "yes" to fixing the older bugs in this release):
- **One release**: 2.3.0 support, the scaling / range / knob-order fixes and the pedal metronome ship together.
- **N window gets two tabs, "Pedal" and "Computer".** Pedal = exactly the pedal's controls (on/off, volume, sound,
  time signature, subdivision, tap). Computer = today's metronome, unchanged. With a 2.3.0 pedal connected it opens
  on Pedal; otherwise only Computer exists.
- **One click at a time**: starting one metronome stops the other.
- **Global / Preset**: show the pedal's switch next to the tempo, and always write the mode the pedal is in.
- **External MIDI clock running** (state field 61): the tempo is read-only with a note.
- **Range**: on 2.3.0 the tempo field follows the pedal; the computer metronome keeps 30–300.
- Overwriting Cal 1–5 with sweep presets and saving them: allowed, done (table in `NANOS-2.3-VERIFICATION.md`).

Measured on the pedal (type 145 = TempoScreenMessage; nothing saved, tempo back at 120):
- **Range 40–240 BPM, clamped by the pedal** (241 → 240, 30 and 39 → 40); **decimals are kept** (120.5).
- **A 1.2.3 bug on 2.3.0: the first `3:1` frame after a `3:0` only "opens the screen".** Its tempo is ignored; the pedal
  answers `{1:1 3:1 5:<its tempo>}`. Later `3:1` frames set the tempo (state field 56 follows, preset marked edited;
  writing the stored value clears it). **A `3:0` frame only closes: a tempo in it is ignored.** So a typed value
  (one live + one commit) is lost, and the first step of a drag is dropped. New sequence: open (`3:1`, current
  values), wait for the answer, write, close with `{3:0}`.
- **The pedal does not report its metronome settings**: the answer to upstream's whole frame (fields 3–11) is the same
  short `{1:1 3:1 5:bpm}`. The editor has to keep its own copy and send it whole, as upstream does (and as the app
  seems to: its Tempo screen showed muted / 0 dB / Blip / 4/4 / 1/4).
- Our writes never switched the metronome on (the app still showed it muted afterwards).

Also: the dev Electron instance died once mid-session (23:46, last line `IOBluetoothDeviceInquiry dealloc`), between
two presets; relaunching and reconnecting worked. Cause not looked at.

## Model corrections to make (proven by the sweep presets, 2026-11-17 23:50; app read through iPhone Mirroring)

Sweep = every continuous parameter of an effect written with a different travel per wire index (table of travels in
`~/DevProjects/mac_projects/NANOS-2.3-VERIFICATION.md`, raw in `NANOS-2.3-sweep-travels.json` beside it), then each
control read in the official app. "t" below is knob travel (the wire's 0–1); skew s means value = min + (max − min) · t^(1/s).

1. **Classic reverbs: Mix is the LAST wire index, everything else moves down by one.** True wire order:
   - Hall, Room: Decay 0, Pre Delay 1, High Pass 2, Low Pass 3, Mix 4.
   - Cave: Decay 0, Pre Delay 1, Damping 2, High Pass 3, Low Pass 4, Mix 5.
   - Modulated: Decay 0, Pre Delay 1, Mod Speed 2, Mod Depth 3, High Pass 4, Low Pass 5, Mix 6.
   - Ambience: Size 0, Pre Delay 1, High Pass 2, Low Pass 3, Mix 4.
   Evidence (Hall, t = 0.10 / 0.18 / 0.26 / 0.34 / 0.42 on wire 0–4): app shows Decay 1.19 s, Pre Delay 6.7 ms, High
   Pass 103 Hz, Low Pass 2655 Hz, Mix 42.0 %. Cave (0.10 … 0.50): Decay 5.32 s, Pre Delay 12.4 ms, Damping 26 %, High
   Pass 149 Hz, Low Pass 2496 Hz, Mix 50.0 %. Modulated (0.10 … 0.58): Decay 1.19 s, Pre Delay 12.4 ms, Mod Speed
   0.62 Hz, Mod Depth 34.0 %, High Pass 204 Hz, Low Pass 4328 Hz, Mix 58.0 %. Room: Decay 0.14 s, Pre Delay 5.8 ms,
   103 Hz, 2655 Hz, 42.0 %. Ambience (wire 0 at 0.10, wire 1 at 1.0, then 0.26 / 0.34 / 0.42): Size Small, Pre Delay
   100.0 ms, 103 Hz, 2655 Hz, Mix 42.0 %. All of these equal upstream's ranges with skew 0.6 on the new index.
   Ranges: Room and Ambience Pre Delay 0–100 ms (Hall 1–100, Cave / Modulated 1–200 as we have).
   Keep the order shown in the UI (Mix first, as the app shows it); change only the wire index. Mind Hall, Blossom and
   Shimmer were not swept (Mind Hall's High / Low Pass indices are right).
2. **Upstream's skew wins over #31's fitted curve wherever both exist** (all 23 controls; every one measured agrees
   with the skew: delays' and reverbs' High / Low Pass, e.g. Dual Delay t 0.329 / 0.367 → 142 Hz / 3822 Hz, Dual
   Reverse High Pass t 0.71 → 461 Hz). #31's curve stays only where upstream has no skew (Parametric 3, Transpose,
   Envelope Filter Reso, Dual Reverse Low Pass, …).
3. **Low-High Cut**: HPF Freq and LPF Freq are both 20–20000 Hz, skew 0.3 (t 0.18 → 86 Hz, t 0.34 → 568 Hz; earlier
   0.25 / 0.5 / 0.75 → 217 / 2002 / 7678 Hz).
4. **Graphic 9**: LPF is 1000–20000 Hz, skew 0.6 (t 0.5 → 6985 Hz, t 0.827 → 14.8 kHz). HPF is 20–20000 Hz, skew 0.3
   (one point: t 0.10 → 29 Hz; "OFF" at 0). Bands and Output are right.
5. **Blossom "E.R. Length"** is linear (t 0.504 → 50 %): drop its skew.
6. **Envelope Filter**: Attack and Decay 10–1000 ms linear (t 0.18 → 188.2 ms, t 0.26 → 267.4 ms, 0.5 → 505.0);
   Level −20…+20 dB linear (t 0.504 → 0.1 dB, 0.245 → −10.3 dB; the sweep point t 0.42 read −2.7 dB, 0.5 dB off a
   straight line, cause unknown); Freq Depth −10000…+10000 Hz linear (t 0.58 → 1600 Hz, 0.25 → −4997 Hz); Sens,
   LP/BP/HP, Reso, Mix are right. Freq is not right either (t 0.25 → 118 Hz, 0.5 → 1010 Hz; #31 gives 89 / 1197) but
   two points do not pin a curve: leave it.
7. **Dyn Depth** (Digital Delay (ST), Dual Delay, Dual Reverse Delay) is 0–60 dB, skew 0.6 (t 0.443 → 15.4 dB,
   t 0.519 → 20.1 dB; factory 10.0 dB), not 0–100 %.
8. **Dual Reverse Delay "Trig Threshold"** is −40…0 dB linear (t 0.405 → −23.8 dB).
9. **Circular Delay**: Feedback is 0–95 % (t 0.318 → 30.21 %); Delay Time is linear as we have (t 0.245 → 510.4 ms).
   High Pass fits 20–13000 Hz with skew 0.6 (t 0.464 → 3630 Hz, 0.499 → 4098 Hz) and Low Pass about 20–20000 Hz with
   skew 0.61 (t 0.536 → 7183 Hz, 0.5 → 6416 Hz): two points each, approximate. Mod Rate (t 0.609 → 1.92 Hz) unknown.
10. **Pitch is not offered in Pre FX 2** by the official app and the pedal refuses it: hide the category there.
11. Not changed, for the record: the app has no Mod Rate / Mod Depth on Dual Delay (we list wire 8 and 9); the app
    names "Analog Delay (ST)", "Tape Delay (ST)", "Parametric-3", "Graphic-9".

## Pedal tempo and metronome: the design to build (steps 4–5; Anup's decisions above)

**Protocol** (type 145, TempoScreenMessage; upstream `tempoFrame` / `handleTempoScreen`, checked on the pedal):
fields 3 tempoScreenActive, 4 tempoIsGlobal, 5 tempo (f32), 6 externalMidiClockRunning, 7 volume (f32 dB, −60…+9),
8 muted, 9 time signature (index into the 21), 10 note (1/4, 1/8, 1/8T, 1/16), 11 sound (Blip, Digital).
State dump: 24 firmware, 55 tempoIsGlobal, 56 tempo, 61 externalMidiClockRunning. Pedal → editor: `{1:1 3:1 5:bpm}`
when the screen opens (never the metronome settings).

**Two kinds of frame**
- *Short* (fields 3–6 only, what 1.2.3 sends): for everything that only concerns the tempo or the Global / Preset
  mode. Verified: sets the tempo while the screen is open; the app showed the metronome still muted afterwards.
- *Whole* (fields 3–11, upstream's): only when the user changes a metronome control in the Pedal tab. The pedal does
  not report these settings, so the editor keeps its own copy (defaults: muted, 0 dB, 4/4, 1/4, Blip; remembered in
  localStorage) and the tab says so. Never send a whole frame merely because a window or tab opened.

**Sequence on firmware ≥ 2.3** (the 1.2.3 sequence loses writes there): open with a short frame carrying the pedal's
current tempo and mode → wait for the pedal's answer (or 300 ms) → write (short or whole frames, the last value wins,
about 120 ms apart while a value moves) → when the change has settled (the existing settle delays) or the Pedal tab
closes: close with `{3:0}` alone → re-read the state (edited flag, the pedal's clamped tempo). While the Pedal tab is
open the screen stays open. Save first flushes pending tempo writes and closes. Field 4 always carries the mode the
pedal is in (state 55), field 6 is sent as 0. Firmware < 2.3 keeps today's frames, timing and 30–300 range.

**Tempo field (inspector)** on ≥ 2.3: 40–240 BPM; a typed decimal is kept (one decimal shown only when it is not a
whole number); −/+ and arrows step by 1. Next to it the pedal's **Global | Preset** switch (writes the mode with a
short frame, then re-reads). When state field 61 says an external MIDI clock is running: field and switch are
read-only with the note "Following MIDI clock".

**Metronome window (N)**: two tabs, **Pedal** and **Computer**. Pedal exists only when connected to firmware ≥ 2.3
and is then the tab the window opens on; otherwise the window is today's (Computer only, no tab bar). Pedal tab:
tempo with tap, Global | Preset, Metronome on/off, Volume (−60…+9 dB, 0.5 dB steps), Sound, Time signature (the 21
of the app, same order), Subdivision. No beat lights (they could not be in time with the pedal). Computer tab: today's
Simple / Advanced metronome, unchanged, including "Follow the preset tempo".

**One click at a time**: switching the pedal metronome on stops the computer metronome; starting the computer
metronome mutes the pedal metronome (a whole frame with muted) if the editor's copy says it is on.

**Demo pedal** (firmware 2.3.0 by default) must behave like the real one: the first `3:1` after a close only opens
and is answered with `{1:1 3:1 5:bpm}`; later `3:1` frames set the tempo (clamped 40–240, decimals kept) and mark
the preset edited; `3:0` only closes; whole frames store the metronome settings; the state dump carries 55 / 56 /
61. Test hooks for "pedal is in Global mode" and "MIDI clock running". A demo pedal on 2.2.1 keeps the old behaviour.

**Still to hear on the real pedal** (needs Anup's ears): that a tempo change from the editor never starts the click;
metronome on / off, volume, sound, time signature and subdivision from the Pedal tab; that our computer metronome
and the pedal's exclude each other as designed.

## Status on 2026-11-18, 03:30 (leader session; nothing committed in either repo)

Electron worktree (`feature/nanos-2.3`, on top of 9d72a2e, all uncommitted):
- `editor/patches/0002-nanos-2.3-model-corrections.patch` (new) + header line of 0001: items 1–9 of "Model
  corrections to make"; `pro/ui.js`: Pitch hidden in the Pre FX 2 picker.
- `pro/ui.js` / `pro/ui.css`: the 2.3.0 tempo sequence, Global | Preset switch, MIDI-clock read-only state, the
  metronome window's Pedal | Computer tabs, one click at a time, the demo pedal's 2.3.0 tempo behaviour
  (`?demoFirmware=2.2.1` keeps the old one; hooks `__demo.hooks.globalTempo` / `midiClock`).
- `npm run test:ux`: **953/953** (run with the display awake: `caffeinate -d -i npm run test:ux`. With the display
  asleep the Mac's audio clock stops and 11 computer-metronome checks fail, on untouched HEAD as well).
- Worker's open points: opening the Pedal tab sends nothing (the screen opens on the first change); on 2.3 every
  tempo write marks the preset edited, so the tempo trainer with "Follow the preset tempo" now does too; T taps in
  the Computer tab too; Graphic 9 HPF shows 20 Hz where the app says "OFF"; Room Pre Delay at 0.18 gives 5.7 ms
  (app 5.8).

Native worktree (`nano-cortex-editor-mac/.claude/worktrees/nanos23`, `feature/nanos-2.3` from `origin/staging`,
uncommitted): both ports done. Second port (04:00): model corrections with skew-first and wire indices, Pitch hidden
in Pre FX 2, `NanoCore/Sources/NanoCore/TempoScreen.swift` (pure state machine for the 2.3 sequence, `Tempo23`,
`PedalMetronome`), Global | Preset switch, MIDI-clock lock, Pedal | Computer tabs (`MetronomeOverlay.swift`),
FakePedal 2.3.0 behaviour, demo hooks `-demo.tempoGlobal YES` / `-demo.midiClock YES` and `/fakehooks`, DECISIONS
#40–42, PROTOCOL-NOTES §11 / §16. **NanoCore 155/155, app unit tests 109/109, app builds.** The UI smoke
(`NanoCortexEditorUITests`, incl. the new `testPedalTempoAndMetronomeTabs`) has NOT passed yet: it was run at 03:50
with the screen locked and every test failed with "Failed to activate application" (preferences and Activity log
restored afterwards). Run it again with Anup logged in. Native differences from Electron the worker reports: ⌘M opens
the window (not N); demo mode keeps the pedal-metronome copy in memory; a decimal preset tempo is rounded for the
(integer) computer metronome; Discard and a footswitch assignment also abandon a pending tempo sequence.

Not done yet: hardware check of the new builds (the pedal was not reachable after the Mac slept at about 00:20);
the listening checks in "Still to hear on the real pedal"; commits and the two PRs (only when Anup says so);
CHANGELOG / README / MANUAL / version (1.3.0 was earmarked for MCP: ask Anup which number this release gets);
deleting the Cal presets (54–61; 54–58 now hold the sweeps) when Anup says so; telling upstream (DrD85) about the
reverb wire order, Low-High Cut ranges and the 2.3.0 tempo sequence, if Anup wants that.

## 2026-11-18 morning: checked on the pedal, release number, clean-up

- Anup: the release is **1.2.4** (both editors); commit and open the PRs to `staging`: yes; delete the Cal presets:
  yes; report the findings to the upstream author: **no**.
- **New Electron build on the pedal** (nothing saved): the sweep presets read exactly as the app showed them (Hall:
  Mix 42.0 %, Decay 1.19 s, Pre Delay 6.7 ms, High Pass 103 Hz, Low Pass 2.65 kHz; Room, Cave, Modulated, Ambience,
  Low-High Cut 86 / 568 Hz, Graphic 9 29 Hz / 14.8 kHz, Dyn Depth 15.4 / 20.1 dB, Trig Threshold −23.8 dB, Circular
  Delay Feedback 30.21 %). Known leftovers: Envelope Filter Level −3.2 dB (app −2.7) and Freq 1.20 kHz (app 1010 Hz),
  Circular Delay Low Pass 7.21 kHz (app 7183 Hz) and Mod Rate 6.1 Hz (app 1.92 Hz), Room Pre Delay 5.7 ms (app 5.8).
- **Tempo sequence on the pedal**: typed 123 → open, the pedal's answer, the tempo frame, `{3:0}`, state 123 and
  edited; 120.5 kept; 300 → 240; the first + step lands (121); back at 120 the edited flag clears.
- **Global | Preset on the pedal**: the switch flips state field 55; after a mode change the pedal sends an
  unsolicited `{1:1 3:1 [4:1] 5:bpm}`. In Global mode a tempo change does not mark the preset edited and the tempo
  stays across preset changes (as the demo pedal assumes). Left on Preset, 120 BPM.
- **Cal presets deleted** (slots 54–61, type 50, each acked `{1:6 3:index 4:1}`); a fresh connection lists them as
  Empty; 62 and 63 untouched; pedal on preset 26.
- Tests with 1.2.4 in place: Electron `test:ux` 953/953; native NanoCore 155/155, app unit tests 109/109, UI smoke 8/8
  (screen unlocked).
- **Still open**: the listening checks ("Still to hear on the real pedal"), the native app on the real pedal,
  screenshots in both manuals (the tempo row and the Pedal tab are described but not pictured), merging and tagging.

## 2026-11-18, the listening check: short frames reset the metronome (fix in progress)

Anup, listening: "changing the tempo changes the subdivision value … it gets reset back to the quarter". So a `3:1`
frame without fields 7–11 makes the pedal fall back to defaults for what is missing (heard: note → 1/4; the click kept
playing). **The "short frame" idea in the design above is wrong on 2.3.0: every `3:1` frame (the open frame and every
write) must be whole, carrying the editor's copy of the metronome settings.** Close stays `{3:0}`.
Probed on the pedal (whole frames, values chosen to be silent): the state dump does not hold the metronome's on / off,
volume, time signature, note or sound; **state field 60 is tempoScreenActive** (1 while the screen is open, absent
after `{3:0}`). So the settings stay write-only and the editor's copy is the only source; field 60 lets the editor
notice when its idea of "screen open" is wrong.

**Fixed the same morning** (both editions, on top of the first commits of the PRs): every `3:1` frame on >= 2.3 is
whole and carries the editor's copy (open frame included); state field 60 corrects the editor's open / closed idea;
the demo / fake pedal resets missing fields like the real one. Electron also stubs upstream's metronome UI in
`scripts/build-core.js` (`metroRefresh` and friends): it found OUR `#metroOverlay`, threw on its own missing
children and cut every state read short while the N window was open (since the V1.18.0 sync). Electron
`test:ux` 963/963; native NanoCore 158, app unit 109. Checked on the pedal with the Electron build: a + / − step
sends open (whole), tempo (whole), close, and the tempo lands. Anup's other two reports ("the volume is also not
respected", "goes back up when I switch presets, but on the UI it is still low") had the same cause: the log shows
the slider sent the right dB and the next short tempo / reopen frame reset it.

**Confirmed by Anup, listening, on the fixed Electron build** (2026-11-18 midday): "the metronome works now. I've
tested all the behaviours, seems ok to me." **Native debug build on the real pedal** (from the worktree, dev remote
4849): connects to the remembered pedal, syncs on 2.3.0 without a banner, tempo 139 → 140 → 139 goes out as open
(whole), tempo (whole), close, and the pedal's state follows. Its default copy (muted, 0 dB, 4/4, 1/4, Blip) went
out with it: each edition keeps its own copy, so the pedal's metronome settings are now those. Native UI smoke 8/8 on
the fix. Clean-up: the native app's preferences and Activity log are as before the test runs; the Electron dev run's
folder `~/Library/Application Support/Nano Cortex Editor` is removed. Preset 26 on the pedal still carries an
unsaved tempo (139) from the listening test.
**Left for the release**: merge PR #40 (Electron) and PR #31 (native) into `staging`, the staging → main PRs, tags
`v1.2.4` on both, verify the downloads; manual screenshots for the tempo row and the Pedal tab.

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
