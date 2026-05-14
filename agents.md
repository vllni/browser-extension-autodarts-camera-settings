# Autodarts Camera Settings – Browser Extension

## Overview

Browser extension that injects V4L2 camera control panels into the Autodarts board's `/config` page. Clicking a camera stream image opens a floating panel with sliders, toggles, and selects for every V4L2 control exposed by the board's REST API.

## Architecture

| File | Purpose |
|------|---------|
| `src/content.js` | Single IIFE content script — injects MDI CSS, attaches click handlers to camera image zones, builds and manages the settings panel |
| `src/content.css` | Styles matching the Autodarts Chakra UI dark theme |
| `src/manifest.chrome.json` | Chrome MV3 manifest |
| `src/manifest.firefox.json` | Firefox MV2 manifest (gecko ID + `browser_specific_settings`) |
| `build.sh` | Builds `dist/chrome/` and `dist/firefox/` and zips both |
| `tests/content.test.js` | Jest + jsdom tests for the content script |

## Build & Test

```bash
npm install       # install Jest + jsdom
npm test          # run tests (24 tests)
bash build.sh     # produces dist/chrome/ dist/firefox/ and .zip packages
```

## Key Conventions

- **Match pattern** is `http://*/config` (root-level path, no prefix wildcard) — the board runs at `http://<ip>:<port>/config` directly.
- **Image zone selector**: `img[src*="/api/streams/cams/"]` → walk two levels up to get the container that holds only the stream image + calibration SVG (no buttons), avoiding interference with the Flip/Rotate controls.
- **MDI icons** are loaded from the jsDelivr CDN (`@mdi/font@7.4.47`) by the content script — no bundled icon files.
- **Design tokens** (dark bg `#1a202c`, accent green `rgb(154,230,180)`, border `rgba(255,255,255,0.16)`) must be preserved to match the Autodarts Chakra UI theme.
- **V4L2 control types**: `0` = integer (slider + number), `1` = boolean (toggle), `2` = menu (select). `isInactive: true` → render disabled.
- **Snapshot on open**: values are captured when the panel first opens; "Restore previous" replays those values via sequential `PATCH` calls.
- Both manifests must stay in sync (version, match patterns, file list). `build.sh` stamps the release tag version into both at release time.

## API Reference

- `GET /api/cams/controls/{cam}` — fetch controls object
- `PATCH /api/cams/controls/{cam}` — update one or more controls (`{ "brightness": -10 }`)
- `POST /api/cams/controls/{cam}/reset` — reset to device defaults
