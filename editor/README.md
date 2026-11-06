# Upstream editor (vendored, verbatim)

`index.html` is the community **Nano Cortex Editor** by Dominik Schmidt, MIT:
<https://github.com/DrD85/nano-cortex-editor>, commit `5ff9796e3c3b16b3349a4e1442157d1b477addec` (V1.12.1, 2026-11-05).

Don't edit it. `scripts/build-core.js` extracts the protocol layer from it into `pro/core.js`; the full upstream UI
stays available in the app under **View → Classic Editor**.

It is itself a superset of the earlier community editor by choldy (<https://github.com/choldy/nano-cortex-web-editor>,
MIT), which this repo vendored until 2026-10-08.

To update: replace `index.html`, bump the commit above, run `npm run build:core` and `npm run test:ux`.

Licence and attribution for both upstream editors: `../THIRD_PARTY_NOTICES.md`.
