# Nano Cortex live-preview PCAP - decoded report

Source: `C:\Users\cdhan\Desktop\nano-cortex-bt.pcap`
Generated: `2026-10-14T23:03:22-05:00`
PCAP 2.4, link type 201, snaplen 2048; 250 HCI records; 88 complete ATT messages.
Capture time: `2026-10-14T17:54:16.236-05:00` to `2026-10-14T17:54:33.534-05:00`; relative duration `17.298s`.

## What this trace proves

- The iOS app uses the Nano's BLE GATT service, writing to ATT handle `0x0036` (C304) and receiving notifications on `0x0038` (C305).
- The live-preview Play operation is an undocumented streamed typed message `150`; it carries the complete `.cns` bytes and capture metadata in memory-oriented preview fields. It is not the normal library upload message `13`, and no normal slot-load message `80` appears around it.
- The device answers with typed message `151`, reporting the capture metadata and success state. In this trace the preview capture is `65 Deluxe N Overdrive` and the embedded `.cns` is 10,350 bytes.
- The Stop operation is typed message `148`, with a millisecond timestamp and state value `0`; the pedal answers with typed message `149`, echoing the timestamp and returning state/status `1`.
- Type `64` expression-pedal reports are also present, but they are a separate unsolicited stream and are not the live-preview transport.

The two points that should be rechecked with a second controlled capture are the exact human-facing meaning of type-150 fields `7` and `8`, and whether type-149 field `3=1` means acknowledgement or the resulting playback state. The packet sequence itself is directly observed.

## Decoded application timeline

Direction labels use the PCAP metadata: `host -> Nano` is the iPhone/app write direction; `Nano -> host` is the pedal notification direction.

| Time from first record | Packet | Direction | GATT | Message | Stream | Decoded fields |
|---:|---:|---|---|---|---:|---|
|    0.615s | 1 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=11 |
|    0.675s | 2 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=27 |
|    0.705s | 3 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=36 |
|    0.795s | 4 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=48 |
|    0.825s | 5 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=66 |
|    0.885s | 6 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=113 |
|    0.915s | 7 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=209 |
|    0.945s | 8 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=255 |
|    1.455s | 9 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=223 |
|    1.515s | 10 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=87 |
|    1.575s | 11 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=14 |
|    1.605s | 12 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2 |
|    2.325s | 13 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=13 |
|    2.355s | 14 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=44 |
|    2.415s | 15 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=75 |
|    2.475s | 16 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=129 |
|    2.505s | 17 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=222 |
|    2.565s | 18 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=255 |
|    2.955s | 19 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=233 |
|    3.015s | 20 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=133 |
|    3.075s | 22 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=45 |
|    3.105s | 23 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2, 4=2 |
|    3.165s | 24 | Nano -> host | 0x0038 | type 64 - expression pedal position | 1 | 1=1, 3=2 |
|    3.879s | 26 | host -> Nano | 0x0036 | type 1 - current-state request | 1 | 1=3, 3=1, 4=1, 5=1 |
|    3.975s | 28 | Nano -> host | 0x0038 | type 2 - current-state response | 2 | 1=1, 3=117, 4=70, 5=128, 6=128, 7=128, 8=146, 9=4, 10=4, 11=2, 12=1, 13=3, 14=29, 15=31, 24="2.2.1", 25="05c36621", 26=25, 27=10, 28=36, 29=40, 30=1, 31=bytes[5] SHA-256 f613059cfba2cf127dd8644df2407b0472882b5be6674997c8e0fea11299b20f, hex 01 00 01 01 00, 32={1:0; 2:"BluesBreaker 2"; 3:"413a23c602d1d3e78138fd60a500b9c76b37a84e3f459868a8d1e1db7fb3e763"}, 33={1:0; 2:"YA YORK 212 DV77 Mix 01"; 3:"YA YORK 212 DV77 Mix 01"}, 34={1:"413a23c602d1d3e78138fd60a500b9c76b37a84e3f459868a8d1e1db7fb3e763"; 2:"BluesBreaker 2"; 3:"bda16563-9b77-4361-add9-eeb88a920fea"; 4:{1:"161cc91b-aeb3-49e3-88c8-9ea1f0649b70"; 2:"ToneJunkie"}; 6:"default"; 7:"#tonejunkie #overdrive #vintag"; 8:6; 10:"instrument_not_set"; 12:"1"; 13:0}, 35={1:"OH Mdrn-Prog Balanced"; 2:""; 3:"OH Mdrn-Prog Balanced"}, 37=1, 38=2, 40=4, 41=1, 42=70, 44=154, 46=fixed32 00 00 DC 43, 48=18001, 49=27, 50=16011, 51=6010, 52=8000, 53=fixed32 FF FE FE 3E, 55=1, 56=fixed32 00 00 1E 43, 63=1 |
|    4.008s | 33 | host -> Nano | 0x0036 | type 137 - FX parameter request | 1 | 1=3, 3=4 |
|    4.127s | 35 | Nano -> host | 0x0038 | type 138 - FX parameter response | 1 | 1=6, 4=bytes[20] SHA-256 a43f1dbb72161c34aa61ff99a4531b9d2d1e8e779f245265c4a4287bcb12fe12, hex 7F 81 23 3F 03 D3 7F 3E A7 C0 5B 3E 33 8D 21 3F AA F1 12 3F |
|    4.129s | 36 | host -> Nano | 0x0036 | type 28 - slot/block select | 1 | 3=2, 4=4 |
|    8.310s | 52 | host -> Nano | 0x0036 | type 150 - capture preview upload (undocumented) | 23 | capture preview payload; field 5 preview object: .cns bytes[10350] SHA-256 3476e90ee23344f47d29cb861b3faf0833002077de021a22a30d2b5f9600842c, embedded MD5 42f4bd306e08e603e5761303d69b8534; metadata hash=61c8385b78d6a5d671b037ea63b50217719715323a6c083658092d3672e6a8b1, name=65 Deluxe N Overdrive, cloudUUID=f4e6f56f-d811-4dfb-9ac9-d7dbe7a27237; outer 7=2, 8=1 |
|    9.855s | 180 | Nano -> host | 0x0038 | type 151 - capture preview response (undocumented) | 1 | 1=6, 3=1, 4={1:2; 2:"65 Deluxe N Overdrive"; 3:"61c8385b78d6a5d671b037ea63b50217719715323a6c083658092d3672e6a8b1"} |
|    9.885s | 181 | Nano -> host | 0x0038 | type 115 - preset dirty state | 1 | 1=1 |
|   12.314s | 183 | host -> Nano | 0x0036 | type 148 - preview transport request (undocumented) | 1 | 2=1792036468548, 3=0; timestamp-like transaction id raw=1792036468548 |
|   12.376s | 185 | Nano -> host | 0x0038 | type 149 - preview transport response (undocumented) | 1 | 1=1, 2=1792036468548, 3=1 |
|   12.377s | 186 | host -> Nano | 0x0036 | type 1 - current-state request | 1 | 1=3, 3=1, 4=1, 5=1 |
|   12.436s | 189 | Nano -> host | 0x0038 | type 115 - preset dirty state | 1 | 1=1, 3=1 |
|   12.525s | 190 | Nano -> host | 0x0038 | type 2 - current-state response | 2 | 1=1, 3=117, 4=70, 5=128, 6=128, 7=128, 8=146, 9=4, 10=4, 11=2, 12=1, 13=3, 14=29, 15=31, 24="2.2.1", 25="05c36621", 26=25, 27=10, 28=36, 29=40, 30=1, 31=bytes[5] SHA-256 f613059cfba2cf127dd8644df2407b0472882b5be6674997c8e0fea11299b20f, hex 01 00 01 01 00, 32={1:0; 2:"BluesBreaker 2"; 3:"413a23c602d1d3e78138fd60a500b9c76b37a84e3f459868a8d1e1db7fb3e763"}, 33={1:0; 2:"YA YORK 212 DV77 Mix 01"; 3:"YA YORK 212 DV77 Mix 01"}, 34={1:"413a23c602d1d3e78138fd60a500b9c76b37a84e3f459868a8d1e1db7fb3e763"; 2:"BluesBreaker 2"; 3:"bda16563-9b77-4361-add9-eeb88a920fea"; 4:{1:"161cc91b-aeb3-49e3-88c8-9ea1f0649b70"; 2:"ToneJunkie"}; 6:"default"; 7:"#tonejunkie #overdrive #vintag"; 8:6; 10:"instrument_not_set"; 12:"1"; 13:0}, 35={1:"OH Mdrn-Prog Balanced"; 2:""; 3:"OH Mdrn-Prog Balanced"}, 37=1, 38=2, 40=4, 41=1, 42=70, 44=154, 46=fixed32 00 00 DC 43, 48=18001, 49=27, 50=16011, 51=6010, 52=8000, 53=fixed32 FF FE FE 3E, 55=1, 56=fixed32 00 00 1E 43, 63=1 |

## Preview transaction reconstructed

```text
Play capture
  host -> Nano  type 150  streamed over C304, 23 chunks / 10,964 bytes including body+type
                       body field 5 = preview object
                       preview object field 1 = 10,350-byte .cns + MD5
                       preview object field 2 = capture metadata
                       outer fields 7=2, 8=1
  Nano -> host  type 151  {1:6, 3:1, 4:capture metadata}

Stop capture preview
  host -> Nano  type 148  {2: timestamp-like transaction id, 3:0}
  Nano -> host  type 149  {1:1, 2: same timestamp, 3:1}
```

The transfer starts at approximately `+8.310s`; the preview response arrives at `+9.855s`; the stop request is at `+12.314s`. This ordering is why type 150 is the strongest evidence for the Play action, while type 148/149 are the Stop/ack exchange in this recording.

## Expression pedal messages (separate from preview)

The trace contains the following type-64 position reports where field 3 is the expression selector (`2`). Field 4 is the raw 0-255 position; omitted field 4 means heel/zero.

-    0.615s = 11/255 (4.3%)
-    0.675s = 27/255 (10.6%)
-    0.705s = 36/255 (14.1%)
-    0.795s = 48/255 (18.8%)
-    0.825s = 66/255 (25.9%)
-    0.885s = 113/255 (44.3%)
-    0.915s = 209/255 (82.0%)
-    0.945s = 255/255 (100.0%)
-    1.455s = 223/255 (87.5%)
-    1.515s = 87/255 (34.1%)
-    1.575s = 14/255 (5.5%)
-    1.605s = 0/255 (0.0%)
-    2.325s = 13/255 (5.1%)
-    2.355s = 44/255 (17.3%)
-    2.415s = 75/255 (29.4%)
-    2.475s = 129/255 (50.6%)
-    2.505s = 222/255 (87.1%)
-    2.565s = 255/255 (100.0%)
-    2.955s = 233/255 (91.4%)
-    3.015s = 133/255 (52.2%)
-    3.075s = 45/255 (17.6%)
-    3.105s = 2/255 (0.8%)
-    3.165s = 0/255 (0.0%)

## GATT and stream notes

- A normal typed frame is `[length] C0 [protobuf body] [type as little-endian u32]`.
- A large message is sent in 500-byte GATT writes as `[payload length low byte, flags] [payload]`; flags `0x40` marks first, `0x80` marks last, and bit 0 carries the 9th length bit. The final write is padded in this capture.
- The PCAP itself includes lower-level HCI command/event records. The inventory below keeps them available without pretending that opaque controller bytes are application semantics.

## HCI packet inventory

| PCAP record | Relative time | Direction | HCI record | Bytes | Summary |
|---:|---:|---|---|---:|---|
| 0 |    0.000 | Nano -> host | HCI event 0xFF | 55 | event payload 48 bytes |
| 1 |    0.615 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 2 |    0.675 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 3 |    0.705 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 4 |    0.795 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 5 |    0.825 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 6 |    0.885 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 7 |    0.915 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 8 |    0.945 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 9 |    1.455 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 10 |    1.515 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 11 |    1.575 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 12 |    1.605 | Nano -> host | HCI ACL | 26 | handle 0x402, PB 2, payload 17 bytes |
| 13 |    2.325 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 14 |    2.355 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 15 |    2.415 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 16 |    2.475 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 17 |    2.505 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 18 |    2.565 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 19 |    2.955 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 20 |    3.015 | Nano -> host | HCI ACL | 29 | handle 0x402, PB 2, payload 20 bytes |
| 21 |    3.032 | Nano -> host | HCI event 0xFF | 78 | event payload 71 bytes |
| 22 |    3.075 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 23 |    3.105 | Nano -> host | HCI ACL | 28 | handle 0x402, PB 2, payload 19 bytes |
| 24 |    3.165 | Nano -> host | HCI ACL | 26 | handle 0x402, PB 2, payload 17 bytes |
| 25 |    3.313 | Nano -> host | HCI event 0xFF | 78 | event payload 71 bytes |
| 26 |    3.879 | host -> Nano | HCI ACL | 30 | handle 0x402, PB 0, payload 21 bytes |
| 27 |    3.915 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 28 |    3.975 | Nano -> host | HCI ACL | 260 | handle 0x402, PB 2, payload 251 bytes |
| 29 |    3.977 | Nano -> host | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 30 |    3.978 | Nano -> host | HCI ACL | 26 | handle 0x402, PB 1, payload 17 bytes |
| 31 |    3.985 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 32 |    4.005 | Nano -> host | HCI ACL | 86 | handle 0x402, PB 2, payload 77 bytes |
| 33 |    4.008 | host -> Nano | HCI ACL | 26 | handle 0x402, PB 0, payload 17 bytes |
| 34 |    4.097 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 35 |    4.127 | Nano -> host | HCI ACL | 46 | handle 0x402, PB 2, payload 37 bytes |
| 36 |    4.129 | host -> Nano | HCI ACL | 26 | handle 0x402, PB 0, payload 17 bytes |
| 37 |    4.155 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 38 |    4.185 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 39 |    5.585 | Nano -> host | HCI event 0xFF | 58 | event payload 51 bytes |
| 40 |    6.025 | Nano -> host | HCI event 0xFF | 55 | event payload 48 bytes |
| 41 |    7.278 | host -> Nano | HCI command 0xFF3E | 17 | parameter length 9 |
| 42 |    7.284 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 43 |    7.285 | host -> Nano | HCI command 0xFF42 | 20 | parameter length 12 |
| 44 |    7.290 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 45 |    7.290 | host -> Nano | HCI command 0xFF42 | 20 | parameter length 12 |
| 46 |    7.294 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 47 |    7.294 | host -> Nano | HCI command 0xFF3E | 17 | parameter length 9 |
| 48 |    7.296 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 49 |    7.297 | host -> Nano | HCI command 0xFF3F | 9 | parameter length 1 |
| 50 |    7.298 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 51 |    7.314 | Nano -> host | HCI event 0xFF | 78 | event payload 71 bytes |
| 52 |    8.310 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 53 |    8.310 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 54 |    8.310 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 55 |    8.327 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 56 |    8.355 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 57 |    8.357 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 58 |    8.357 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 59 |    8.357 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 60 |    8.385 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 61 |    8.388 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 62 |    8.415 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 63 |    8.418 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 64 |    8.418 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 65 |    8.418 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 66 |    8.449 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 67 |    8.475 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 68 |    8.477 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 69 |    8.477 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 70 |    8.477 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 71 |    8.505 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 72 |    8.508 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 73 |    8.536 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 74 |    8.538 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 75 |    8.538 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 76 |    8.538 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 77 |    8.567 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 78 |    8.595 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 79 |    8.596 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 80 |    8.597 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 81 |    8.597 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 82 |    8.625 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 83 |    8.630 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 84 |    8.655 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 85 |    8.656 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 86 |    8.657 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 87 |    8.657 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 88 |    8.687 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 89 |    8.715 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 90 |    8.718 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 91 |    8.718 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 92 |    8.718 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 93 |    8.745 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 94 |    8.749 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 95 |    8.775 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 96 |    8.777 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 97 |    8.777 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 98 |    8.777 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 99 |    8.807 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 100 |    8.836 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 101 |    8.838 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 102 |    8.838 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 103 |    8.838 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 104 |    8.848 | Nano -> host | HCI event 0xFF | 78 | event payload 71 bytes |
| 105 |    8.865 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 106 |    8.868 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 107 |    8.895 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 108 |    8.896 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 109 |    8.897 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 110 |    8.897 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 111 |    8.927 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 112 |    8.985 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 113 |    8.987 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 114 |    8.987 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 115 |    8.987 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 116 |    9.015 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 117 |    9.018 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 118 |    9.047 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 119 |    9.049 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 120 |    9.049 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 121 |    9.049 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 122 |    9.107 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 123 |    9.137 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 124 |    9.138 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 125 |    9.138 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 126 |    9.139 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 127 |    9.165 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 128 |    9.168 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 129 |    9.195 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 130 |    9.196 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 131 |    9.197 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 132 |    9.197 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 133 |    9.227 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 134 |    9.255 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 135 |    9.256 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 136 |    9.257 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 137 |    9.257 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 138 |    9.285 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 139 |    9.288 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 140 |    9.315 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 141 |    9.318 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 142 |    9.318 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 143 |    9.318 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 144 |    9.349 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 145 |    9.375 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 146 |    9.378 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 147 |    9.378 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 148 |    9.378 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 149 |    9.405 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 150 |    9.408 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 151 |    9.436 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 152 |    9.437 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 153 |    9.438 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 154 |    9.438 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 155 |    9.467 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 156 |    9.495 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 157 |    9.497 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 158 |    9.497 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 159 |    9.497 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 160 |    9.525 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 161 |    9.530 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 162 |    9.555 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 163 |    9.556 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 164 |    9.556 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 165 |    9.556 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 166 |    9.587 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 167 |    9.615 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 168 |    9.618 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 169 |    9.619 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 170 |    9.619 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 171 |    9.675 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 172 |    9.677 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 173 |    9.705 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 174 |    9.707 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 0, payload 251 bytes |
| 175 |    9.707 | host -> Nano | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 176 |    9.707 | host -> Nano | HCI ACL | 14 | handle 0x402, PB 1, payload 5 bytes |
| 177 |    9.737 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 178 |    9.765 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 179 |    9.835 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 180 |    9.855 | Nano -> host | HCI ACL | 119 | handle 0x402, PB 2, payload 110 bytes |
| 181 |    9.885 | Nano -> host | HCI ACL | 24 | handle 0x402, PB 2, payload 15 bytes |
| 182 |   11.867 | Nano -> host | HCI event 0xFF | 55 | event payload 48 bytes |
| 183 |   12.314 | host -> Nano | HCI ACL | 31 | handle 0x402, PB 0, payload 22 bytes |
| 184 |   12.375 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 185 |   12.376 | Nano -> host | HCI ACL | 33 | handle 0x402, PB 2, payload 24 bytes |
| 186 |   12.377 | host -> Nano | HCI ACL | 30 | handle 0x402, PB 0, payload 21 bytes |
| 187 |   12.405 | Nano -> host | HCI event 0x13 | 12 | event payload 5 bytes |
| 188 |   12.435 | Nano -> host | HCI ACL | 14 | handle 0x402, PB 2, payload 5 bytes |
| 189 |   12.436 | Nano -> host | HCI ACL | 26 | handle 0x402, PB 2, payload 17 bytes |
| 190 |   12.525 | Nano -> host | HCI ACL | 260 | handle 0x402, PB 2, payload 251 bytes |
| 191 |   12.527 | Nano -> host | HCI ACL | 260 | handle 0x402, PB 1, payload 251 bytes |
| 192 |   12.528 | Nano -> host | HCI ACL | 26 | handle 0x402, PB 1, payload 17 bytes |
| 193 |   12.528 | Nano -> host | HCI ACL | 86 | handle 0x402, PB 2, payload 77 bytes |
| 194 |   13.603 | Nano -> host | HCI event 0xFF | 78 | event payload 71 bytes |
| 195 |   15.402 | Nano -> host | HCI event 0xFF | 78 | event payload 71 bytes |
| 196 |   15.798 | host -> Nano | HCI command 0xFF3E | 17 | parameter length 9 |
| 197 |   15.808 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 198 |   15.808 | host -> Nano | HCI command 0xFF41 | 12 | parameter length 4 |
| 199 |   15.810 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 200 |   15.810 | host -> Nano | HCI command 0xFDE6 | 22 | parameter length 14 |
| 201 |   15.814 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 202 |   15.814 | host -> Nano | HCI command 0xFDBD | 24 | parameter length 16 |
| 203 |   15.815 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 204 |   15.815 | host -> Nano | HCI command 0xFDB2 | 16 | parameter length 8 |
| 205 |   15.816 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 206 |   15.816 | host -> Nano | HCI command 0xFDC9 | 8 | parameter length 0 |
| 207 |   15.817 | Nano -> host | HCI event 0x0E | 15 | event payload 8 bytes |
| 208 |   15.823 | host -> Nano | HCI command 0xFFAD | 70 | parameter length 62 |
| 209 |   15.824 | Nano -> host | HCI event 0x0E | 15 | event payload 8 bytes |
| 210 |   15.824 | host -> Nano | HCI command 0xFF41 | 12 | parameter length 4 |
| 211 |   15.827 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 212 |   15.827 | host -> Nano | HCI command 0xFFAD | 70 | parameter length 62 |
| 213 |   15.830 | Nano -> host | HCI event 0x0E | 15 | event payload 8 bytes |
| 214 |   15.830 | host -> Nano | HCI command 0xFFAD | 70 | parameter length 62 |
| 215 |   15.832 | Nano -> host | HCI event 0x0E | 15 | event payload 8 bytes |
| 216 |   15.832 | host -> Nano | HCI command 0xFFAD | 70 | parameter length 62 |
| 217 |   15.835 | Nano -> host | HCI event 0x0E | 15 | event payload 8 bytes |
| 218 |   15.835 | host -> Nano | HCI command 0xFF41 | 12 | parameter length 4 |
| 219 |   15.836 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 220 |   15.836 | host -> Nano | HCI command 0xFDBD | 24 | parameter length 16 |
| 221 |   15.837 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 222 |   15.837 | host -> Nano | HCI command 0xFDD9 | 38 | parameter length 30 |
| 223 |   15.838 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 224 |   15.838 | host -> Nano | HCI command 0xFDD9 | 38 | parameter length 30 |
| 225 |   15.839 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 226 |   15.839 | host -> Nano | HCI command 0xFDD9 | 38 | parameter length 30 |
| 227 |   15.840 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 228 |   15.840 | host -> Nano | HCI command 0xFDD9 | 38 | parameter length 30 |
| 229 |   15.842 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 230 |   15.842 | host -> Nano | HCI command 0xFDD9 | 38 | parameter length 30 |
| 231 |   15.843 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 232 |   15.845 | host -> Nano | HCI command 0xFF42 | 20 | parameter length 12 |
| 233 |   15.849 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 234 |   15.849 | host -> Nano | HCI command 0xFF42 | 20 | parameter length 12 |
| 235 |   15.852 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 236 |   15.852 | host -> Nano | HCI command 0xFF3E | 17 | parameter length 9 |
| 237 |   15.854 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 238 |   15.854 | host -> Nano | HCI command 0xFF3F | 9 | parameter length 1 |
| 239 |   15.856 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 240 |   17.278 | host -> Nano | HCI command 0xFF3E | 17 | parameter length 9 |
| 241 |   17.288 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 242 |   17.289 | host -> Nano | HCI command 0xFF42 | 20 | parameter length 12 |
| 243 |   17.292 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 244 |   17.292 | host -> Nano | HCI command 0xFF42 | 20 | parameter length 12 |
| 245 |   17.294 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 246 |   17.294 | host -> Nano | HCI command 0xFF3E | 17 | parameter length 9 |
| 247 |   17.297 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |
| 248 |   17.297 | host -> Nano | HCI command 0xFF3F | 9 | parameter length 1 |
| 249 |   17.298 | Nano -> host | HCI event 0x0E | 11 | event payload 4 bytes |

---

This report is generated from the PCAP and intentionally omits the full opaque capture binary. The complete binary evidence remains in the source PCAP named above.
