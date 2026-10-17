# Live Capture Preview

## Summary

Adds undocumented Nano Cortex live capture audition support, including the keep-alive mechanism required for previews longer than approximately 60 seconds.

## Investigation

- Examined the existing Nano Cortex Bluetooth transport and protobuf-style message handling.
- Captured and decoded Bluetooth traffic from the official Neural DSP iOS app.
- Confirmed the undocumented capture preview exchange:
  - Type `150`: chunked temporary capture preview transfer.
  - Type `151`: preview accepted response.
  - Type `148/149`: stop preview request and acknowledgement.
- Confirmed that previews use a temporary audition cache and do not write the capture into a Nano Cortex slot.
- Identified the cause of the desktop preview timeout:
  - Without keep-alive traffic, the Nano stopped previewing after approximately 60 seconds.
  - The iOS app sends type `91` approximately every 20 seconds.
  - The Nano responds with type `92`.
  - The app does not repeatedly send the full capture transfer.
- Added a readable decoded Bluetooth trace under `tools/nano-preview-trace/nano-cortex-bt-readable.md`.

## Implemented

- Added live capture preview transfer support.
- Added preview stop support.
- Added capture MD5 generation and chunking.
- Added combined Live Preview / Stop Preview behavior.
- Added preview state handling for:
  - Preparing
  - Active
  - Stopping
  - Idle
- Prevented repeated button actions while a preview transition is in progress.
- Added the top-level Cab/IR toggle.
- Added preview keep-alive handling:
  - Sends `06 C0 08 03 5B 00 00 00` every 20 seconds.
  - Tracks the type `92` acknowledgement.
  - Starts after preview acceptance.
  - Stops on manual stop, failed stop, disconnect, or preview failure.
- Preserved preview state cleanup during disconnects.

## Merge note

Merging into `main` produced one conflict in `pro/ui.js` within the disconnect handler.

The `main` branch contained newer monitoring and device-state cleanup, while the preview branch contained preview-state and keep-alive cleanup. The conflict was resolved by preserving both sets of behavior:

- Existing device monitoring state is cleared on disconnect.
- The preview keep-alive timer is stopped.
- Preview UI state is reset.
- The user is notified when a disconnect ends an active preview.

No functionality from either branch was discarded.

## Verification

- Confirmed the keep-alive implementation passes JavaScript syntax validation.
- Built the Windows NSIS installer and portable executable from the merged `main` branch.
- Confirmed the merged changes are pushed to `origin/main`.
