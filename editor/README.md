# Upstream editor (vendored, verbatim)

`index.html` is the community **Nano Cortex Editor** by Dominik Schmidt, MIT:
<https://github.com/DrD85/nano-cortex-editor>, commit `43292dbccf1569c7f697b3364af505d489c44334` (v1.5.2, 2026-10-08).

Don't edit it. `scripts/build-core.js` extracts the protocol layer from it into `pro/core.js`; the full upstream UI
stays available in the app under **View → Classic Editor**.

It is itself a superset of the earlier community editor by choldy (<https://github.com/choldy/nano-cortex-web-editor>,
MIT), which this repo vendored until 2026-10-08.

To update: replace `index.html`, bump the commit above, run `npm run build:core` and `npm run test:ux`.

Licence and attribution for both upstream editors: `../THIRD_PARTY_NOTICES.md`.
