---
name: optimize-camera-settings
description: "Optimize Autodarts board camera image quality while keeping FPS between 15 and 30. Use when dart segments are blurry, overexposed, underexposed, or otherwise hard to detect. Iterates by taking live screenshots and adjusting V4L2 controls (brightness, contrast, exposure, gain, sharpness, saturation) via the board REST API until all dartboard segments are clearly visible."
argument-hint: "board URL (e.g. http://192.168.1.50:3180)"
---

# Optimize Autodarts Camera Settings

Iteratively tunes V4L2 camera controls on a live Autodarts board until all dartboard segments are clearly visible and FPS stays within the 15–30 target range.

## When to Use

- Dart segments are misdetected or invisible in the Autodarts app
- Image looks washed out, too dark, motion-blurred, or noisy
- After physically repositioning or replacing a camera
- Board was factory-reset and camera defaults need retuning

## Prerequisites

- The Autodarts board is reachable at a known URL (e.g. `http://192.168.1.50:3180`)
- The Playwright browser tool is available in this session (needed for screenshots)
- The board `/vision` page loads camera stream images at `img[src*="/api/streams/cams/"]`

## Board API Reference

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/cams/controls/{cam}` | Fetch all V4L2 controls for camera `{cam}` (0-based index) |
| `PATCH` | `/api/cams/controls/{cam}` | Set one or more controls: `{ "brightness": -10 }` |
| `POST` | `/api/cams/controls/{cam}/reset` | Reset camera to device defaults |

### Control Types

| `type` | Render | Notes |
|--------|--------|-------|
| `0` | integer | Has `min`, `max`, `step`, `value` |
| `1` | boolean | `value` is `0` or `1` |
| `2` | menu | `value` is index into menu items (`0..max`) |

Controls with `isInactive: true` are read-only — skip them.

### FPS-Affecting Controls to Watch

- `exposureAuto` (type 2): set to `1` (Manual) to unlock `exposureAbsolute`
- `exposureAbsolute` (type 0): lower value → shorter shutter → higher FPS potential; too low → dark/noisy image
- `frameRate` or equivalent if exposed: keep in 15–30 range
- `gain` (type 0): compensates for reduced exposure, but increases noise

## Procedure

### Step 1 — Discover Cameras

Navigate to the board `/vision` page and count the camera stream images:

```
GET {boardUrl}/vision   (open in browser to inspect)
```

Identify how many cameras are present (`n`). Camera indices are `0` to `n-1`.

### Step 2 — Fetch Baseline Controls

For each camera index `i`:

```
GET {boardUrl}/api/cams/controls/{i}
```

Record the full response. Note current `value` for:
- `brightness`, `contrast`, `saturation`, `sharpness`
- `exposureAuto`, `exposureAbsolute`
- `gain`, `backLightCompensation`, `whiteBalanceAuto`, `whiteBalanceTemperature`
- Any `frameRate` or `fps`-named control

### Step 3 — Take a Baseline Screenshot

Navigate the browser to `{boardUrl}/vision` and take a full-page screenshot. Visually assess:

- [ ] All 20 dartboard segments visible and distinct
- [ ] Double and Triple rings visible with clear contrast against adjacent segments
- [ ] Numbers around the board legible
- [ ] No severe bloom/overexposure in bright zones
- [ ] No crushing/underexposure in shadow zones
- [ ] Image is sharp (no motion blur at dart-tip scale)

If the baseline already passes all checks, stop — no tuning needed.

### Step 4 — Set FPS Target First

Before adjusting visual quality, establish FPS within 15–30 fps. This constrains the exposure window.

1. If `exposureAuto` exists: set to `1` (Manual mode) via `PATCH`.
2. Calculate the maximum exposure that still allows ≥ 15 fps:
   - `maxExposure = 1 000 000 / 15 = 66 666 µs` (upper bound)
   - `minExposure = 1 000 000 / 30 = 33 333 µs` (lower bound for 30 fps)
   - Start at `exposureAbsolute = 50 000` as a balanced midpoint.
3. Patch: `{ "exposureAbsolute": 50000 }`.
4. If a direct `frameRate` control exists, patch it to `25` first.

### Step 5 — Tune Visual Quality Iteratively

Run up to **6 iterations**. Stop early if all segment-visibility checks pass.

For each iteration:

1. **Screenshot**: capture `{boardUrl}/vision` in the browser.
2. **Diagnose**: identify the worst remaining issue from this priority list:
   - Overexposed (blown highlights) → lower `exposureAbsolute` by 20% or lower `brightness`
   - Underexposed (dark, noisy) → raise `exposureAbsolute` by 15% (cap at 66 666) or raise `gain` by +1
   - Motion blur → lower `exposureAbsolute` by 25%
   - Low contrast (washed segments) → raise `contrast`; lower `brightness` slightly
   - Color cast / poor white balance → set `whiteBalanceAuto` to `0`, then tune `whiteBalanceTemperature`
   - Soft/blurry but not motion blur → raise `sharpness` by +1 step; lower `gain` if noise is masking edges
3. **Patch** only the control(s) addressing the worst issue. Use a single `PATCH` per iteration.
4. **Verify FPS constraint**: after each patch, re-fetch controls and confirm `exposureAbsolute` ≤ 66 666.
5. **Log** iteration number, control patched, old value → new value, and qualitative assessment.

#### Recommended Starting Ranges (adjust from these if defaulting)

| Control | Conservative Start | Notes |
|---------|--------------------|-------|
| `brightness` | 0 | Board default; adjust ±20 max |
| `contrast` | 32 | Raise to 40–50 if segments wash out |
| `saturation` | 64 | Keep moderate; high saturation hides segment detail |
| `sharpness` | 3 | Raise to 4–5 for crisp segment lines |
| `exposureAbsolute` | 50 000 | Tuned for ~20 fps; stay 33 333–66 666 |
| `gain` | 0–4 | Raise only if image is too dark after exposure limit is hit |

### Step 6 — Validate Final State

Take a final screenshot and confirm:

- [ ] All 20 dartboard segments are visually distinct
- [ ] Wire (spider) lines are visible with clear contrast against segment fields
- [ ] Numbers are legible without bloom
- [ ] No visible motion blur
- [ ] `exposureAbsolute` ≤ 66 666 (≥ 15 fps implied)

### Step 7 — Report

Summarise in a concise table:

| Camera | Control | Before | After |
|--------|---------|--------|-------|
| 0 | exposureAbsolute | 166 665 | 50 000 |
| 0 | contrast | 32 | 45 |
| … | … | … | … |

Include the final screenshot(s) inline. If any check still fails after 6 iterations, note which issue persists and recommend a hardware fix (repositioning, lighting, lens clean).

## Abort Conditions

- Board API returns non-2xx → stop, report the URL and status code, ask the user to verify connectivity.
- `exposureAbsolute` has no `max` > 66 666 → camera cannot sustain 15+ fps via this control alone; inform the user.
- Playwright screenshot fails → fall back to asking the user to describe the image manually.
