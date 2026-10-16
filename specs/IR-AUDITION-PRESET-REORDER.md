# IR audition and preset reorder

## Status

Implementation spec based on two user-supplied Nano Cortex BLE captures (firmware 2.2.1, 2026-10-15). The captures were analyzed locally and are not included in the repository. They confirm the request and response shapes for IR audition, audition stop, and preset moves. The longer capture shows the official app sending type 91 every 20 seconds during an IR preview and receiving successful type 92 replies.

## Goals

- Audition a pedal-library IR from the Cab/IR inspector's **From the library** section without assigning it to an IR slot.
- Drag presets to a new position in the device's 64-preset order.
- Use the pedal's acknowledgements and refreshed state as the source of truth.

This spec does not cover downloading IR files from Cortex Cloud.

## Approved UI scope

The approved reference is [the IR library mockup](ir-library-layout-mockup.html). Use it only for the **From the library** section in the Cab/IR inspector. The mockup's surrounding shell and content are illustrative context, not implementation targets. Do not use it as approval for a broader application redesign. Keep the app shell, header, sidebar, signal chain, preset list, and other inspector sections as they are. The existing **Cabs and IRs on the pedal** section and its slot tiles remain in place with their current layout and sizing; add the compact library section below it. Preset-list drag reordering is a separate, scoped change described later in this spec.

## IR audition

### UI

- In the Cab/IR inspector, replace the **Load from library…** header dropdown with a **From the library** section below the existing **Cabs and IRs on the pedal** slot section. Match the library tiles' height, grid sizing, and spacing to the existing slot tiles. Keep the existing slot section and all surrounding application UI unchanged.
- Show the pedal's factory cabs and user IRs in their existing groups. Remove the redundant type-filter dropdown. The search field filters by item name, group/category, and available item details; hide empty groups and show a “Nothing matches…” message when no results remain.
- Each library tile has a separate Preview button aligned at the right. Clicking the item name/body opens the existing slot chooser; confirming a destination then uses the normal library-to-slot load path. Preview auditions without opening the slot chooser or loading the IR. Keep any explicit slot-targeted context-menu actions working.
- While auditioning, highlight the active library tile, change its Preview button to Stop, and dim the currently selected pedal slot tile. Do not show a separate bottom “Previewing” popup. Starting another IR audition may replace the current audition; the trace shows multiple Play requests followed by one Stop, without intervening stop requests.
- Preview must not invoke `loadLibraryCab`, `chooseSlot`, or type 78, and the editor must not optimistically change preset state or IR slot contents. The pedal may report dirty state after audition; handle that notification as described below.
- Disable pedal audition in demo mode. On hardware, enable it after the connected pedal's library has loaded.

### Protocol

Use the exact 0-based `item.index` and `item.name` from the picker. Encode the small, single-frame request as message type **158**:

```text
{ 4: { 1: item.index, 2: item.name }, 8: 1 }
```

The observed pedal reply is message type **159**:

```text
{ 1: 6, 3: status, 4: { 2: item.name } }
```

Treat field 3 value `1` as accepted. A failed status, write failure, or reply timeout must clear the pending state and leave the From the library section available. Field 8 was `1` for every observed IR Play; preserve that value without assigning it an unverified meaning. The trace did not show a factory-versus-user discriminator in this request, so retain the item category in the UI model and use the item's exact index/name pair. Before claiming support for both categories, verify one factory IR and one user IR because the captures only validate the entries exercised by the user.

Stop uses message type **148** with a millisecond transaction value in field 2 and explicit zero in field 4:

```text
{ 2: transaction, 4: 0 }
```

The observed type **149** acknowledgement is:

```text
{ 1: 1, 2: transaction, 3: 1 }
```

Require the matching transaction and field 3 value `1` before showing the preview as stopped. Keep this IR stop builder separate from the existing capture-preview stop builder: the capture trace uses type 148 field 3 for its zero value.

The captures contain no type 78 slot-load request around IR Play. After Stop, the official app reads current state. The longer capture also has a type 115 dirty notification after the successful Stop acknowledgement. Do not assume audition is state-neutral: perform the normal state refresh and preserve the device-reported dirty state and existing unsaved-edit behavior.

### Keep-alive

The longer capture shows an IR preview active for about 102 seconds. The app sent type 91 at approximately 20, 40, 61, 81, and 101 seconds; each request received type 92 with field 3 equal to `1`. Mirror this observed 20-second cadence using the existing capture-preview keep-alive lifecycle: start after type 159 accepts Play, and stop after type 149 confirms Stop or on disconnect. The trace confirms the app's keep-alive behavior and successful acknowledgements; it does not prove whether preview playback would expire without them.

### State and errors

- Track the active IR by category, index, and name; permit only one in-flight Play or Stop transition.
- A new Play should update the active item only after type 159 accepts it. A failed replacement should preserve the prior active state.
- On disconnect, clear local audition state and the keep-alive timer.
- After Stop, refresh device state and honor type 115 dirty notifications; the longer trace reports dirty after stopping.
- Log message type, index, status, and transaction. Do not log the full library payload or raw BLE identifiers.

## Preset reorder

### UI

- Add drag reordering to the 64 rows rendered by `renderSide()` in `pro/ui.js`.
- Use each row's absolute zero-based device index (`data-n - 1`), even when the list is filtered. Dropping on a row moves the source preset into that destination position; intervening rows shift. Do not treat this as a swap.
- Show a pending state and ignore additional drags until the move is acknowledged and the preset list has been refreshed.
- Preserve the selected preset by its identity after the move. Re-render footswitch assignments from the refreshed device state instead of shifting them locally.
- Follow the existing unsaved-edit prompt before beginning a move when the pedal reports actual unsaved edits.

### Protocol

The trace shows three type **143** moves. Requests use literal field 1 value `4`, field 3 as the source index, and field 4 as the destination index:

```text
{ 1: 4, 3: sourceIndex, 4: destinationIndex }
```

Indices are zero-based. The type **144** acknowledgement echoes the two indices and reports success in field 5:

```text
{ 1: 6, 3: sourceIndex, 4: destinationIndex, 5: 1 }
```

After type 144, request the preset list with type 1:

```text
{ 1: 3, 3: 0, 4: 1, 5: 1 }
```

Parse the type 2 response and replace the displayed 64-entry order from its field 18 records. The observed moves `5 → 3` and `36 → 6` produced insertion moves in the returned list, confirming the index direction and shift behavior. Do not use type 29 for reordering; its fields 5–8 are footswitch assignments.

The pedal emitted type 115 dirty then clean notifications around one move. Treat these as transient reorder side effects while a type 143 operation is pending; do not leave the preset editor marked dirty after the move has completed. If the move is rejected, times out, or returns a mismatched index pair, re-read the list and render the device's actual order rather than applying an optimistic local change.

## Acceptance checks

- Playing an IR sends one type 158 with the selected item's index/name and field 8 set to 1; type 159 success updates the active preview indicator.
- The Cab/IR inspector retains its existing pedal-slot section and surrounding app layout; the new compact **From the library** section matches the pedal slot tile sizing and spacing.
- Library search filters names, groups, and available details, hides groups with no matches, and shows an empty result message when appropriate.
- Clicking a library tile opens slot selection; clicking its Preview button auditions without loading, highlights that tile, dims the current pedal slot, and changes the control to Stop. No bottom preview popup appears.
- Playing an IR sends no type 78, type 80, preset-save, or slot-content write.
- Stopping an IR preview sends type 148 with field 2 transaction and field 4 zero, then accepts only a matching successful type 149 response.
- A long audition sends type 91 every 20 seconds and accepts type 92 with field 3 equal to `1`.
- A type 115 dirty notification after Stop is reflected in the editor and handled by the existing unsaved-edit flow.
- Reordering sends type 143 with absolute zero-based source/destination indexes, then waits for type 144 success and refreshes all 64 names from type 2.
- A returned move changes the order by insertion, preserves preset identities, and updates the selected preset and footswitch rows from authoritative state.
- A failed or uncertain move resolves by refreshing state; the UI never leaves an unconfirmed optimistic order in place.

## Source code touchpoints

- `pro/ui.js`: `inspCab` library section, `openLibraryPicker` for remaining capture and explicit slot-targeted flows, `loadFromLibrary`, `renderSide`, and preview/dirty UI state.
- `pro/core.js`: library item parsing, preset-list refresh, state parsing, and type dispatch.
- `pro/transfer.js`: preview request/reply waiters, type 158/159 handling, and explicit type 148 stop variants.
- `editor/index.html`: keep its legacy editor behavior aligned only if that surface is in scope; this spec targets the current Pro UI.
