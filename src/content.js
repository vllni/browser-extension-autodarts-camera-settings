/**
 * Autodarts Camera Settings – content script
 *
 * Injects V4L2 control panels onto the /config page.
 * Each camera stream image becomes clickable; clicking it opens
 * a slide-in panel with sliders / toggles for every V4L2 control.
 * A "Reset to opened state" button restores the snapshot taken when
 * the panel was first opened.
 *
 * API used (see resolveApiBase for how the base URL is derived — directly on a
 * locally-served board, or via the per-board autodarts.direct relay host when
 * running inside the play.autodarts.io embedded client):
 *   GET  /api/cams/controls/{cam}        – fetch controls
 *   PATCH /api/cams/controls/{cam}       – update a single control value
 *   POST  /api/cams/controls/{cam}/reset – reset all controls to device defaults
 */

(function () {
  'use strict';

  /* ─── Material Design Icons CDN (subset we need) ──────────────────── */
  const MDI_CDN = 'https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css';

  function injectMDI() {
    if (document.getElementById('adcs-mdi-css')) return;
    const link = document.createElement('link');
    link.id = 'adcs-mdi-css';
    link.rel = 'stylesheet';
    link.href = MDI_CDN;
    document.head.appendChild(link);
  }

  /* ─── Utility ─────────────────────────────────────────────────────── */

  /**
   * Resolve the base URL of the board's REST API.
   *
   * The camera API lives on the board, which is NOT always the origin serving
   * the current page:
   *
   * • Direct connection (http://<ip>:3180/config, or the board's relay host
   *   directly): the API is on the current page origin.
   * • Embedded client on play.autodarts.io (…/boards/<id>/config): the page
   *   origin is the cloud host, which does NOT serve the camera API (→ 404). The
   *   board is reached through its per-board relay host
   *   `https://<ip-with-dashes>.<board-id>.autodarts.direct:<tlsPort>`.
   *
   * In every case the camera stream <img> on the page already points at the
   * board (its src is `<base>/api/streams/cams/<n>`), so we derive the base from
   * the image's origin. Images load without a CORS check, so this works even on
   * the cloud client — unlike a `fetch` to the discovery service, which a
   * content script can't reliably make cross-origin. Falls back to the page
   * origin when no stream image is present.
   */
  function resolveApiBase() {
    const img = document.querySelector('img[src*="/api/streams/cams/"]');
    if (img && img.src) {
      try {
        return new URL(img.src, location.href).origin;
      } catch {
        /* fall through to page origin */
      }
    }
    return `${location.protocol}//${location.host}`;
  }

  const ext = (typeof browser !== 'undefined') ? browser
    : (typeof chrome !== 'undefined' ? chrome : null);

  /**
   * Fetch a board API URL, transparently routing cross-origin requests through
   * the background script.
   *
   * On play.autodarts.io the board is reached via its relay host
   * (…autodarts.direct), whose /api/cams/* responses have NO
   * Access-Control-Allow-Origin header. A content-script `fetch` is subject to
   * CORS and gets blocked (TypeError "NetworkError"). The background script
   * holds host permission for *.autodarts.direct, so its fetch is CORS-exempt —
   * we delegate to it whenever the target origin differs from the page origin.
   * Same-origin requests (locally-served board, or the relay opened directly)
   * are fetched straight from the content script.
   *
   * Returns a Response-like object exposing { ok, status, json(), text() }.
   */
  async function boardFetch(url, init) {
    const crossOrigin = new URL(url, location.href).origin !== location.origin;
    if (!crossOrigin || !(ext && ext.runtime && ext.runtime.sendMessage)) {
      return fetch(url, init);
    }
    const resp = await ext.runtime.sendMessage({ type: 'adcs-api', url, init });
    if (!resp) throw new TypeError('NetworkError: no response from background');
    if (resp.error) throw new TypeError(resp.error);
    return {
      ok: resp.ok,
      status: resp.status,
      json: async () => JSON.parse(resp.body),
      text: async () => resp.body,
    };
  }

  async function fetchControls(camIndex) {
    const base = resolveApiBase();
    const res = await boardFetch(`${base}/api/cams/controls/${camIndex}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function patchControl(camIndex, key, value) {
    const base = resolveApiBase();
    const res = await boardFetch(`${base}/api/cams/controls/${camIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function resetControls(camIndex) {
    const base = resolveApiBase();
    const res = await boardFetch(`${base}/api/cams/controls/${camIndex}/reset`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  /* ─── Panel rendering ─────────────────────────────────────────────── */

  /**
   * type values observed in the wild:
   *   0 = integer  (render slider + number input)
   *   1 = boolean  (render toggle)
   *   2 = menu     (render select; menu items = 0..max)
   */

  // Human-readable labels for type-2 (menu) controls
  const MENU_LABELS = {
    exposureAuto: { 0: 'Manual', 1: 'Auto (aperture)', 2: 'Auto (shutter)', 3: 'Auto (aperture+shutter)' },
    powerLineFrequency: { 0: 'Disabled', 1: '50 Hz', 2: '60 Hz' },
  };

  function buildControlRow(key, ctrl, camIndex, onChangeCallback) {
    const row = document.createElement('div');
    row.className = 'adcs-control-row';
    row.dataset.adcsKey = key;
    if (ctrl.isInactive) row.classList.add('adcs-inactive');

    const labelEl = document.createElement('label');
    labelEl.className = 'adcs-control-label';
    labelEl.textContent = ctrl.name;
    row.appendChild(labelEl);

    const inputWrap = document.createElement('div');
    inputWrap.className = 'adcs-input-wrap';

    if (ctrl.type === 1) {
      /* ── Toggle ── */
      const toggle = document.createElement('label');
      toggle.className = 'adcs-toggle';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = ctrl.value === 1;
      checkbox.disabled = ctrl.isInactive;
      checkbox.addEventListener('change', async () => {
        const v = checkbox.checked ? 1 : 0;
        try {
          await patchControl(camIndex, key, v);
          onChangeCallback(key, v);
        } catch {
          checkbox.checked = !checkbox.checked;
        }
      });

      const slider = document.createElement('span');
      slider.className = 'adcs-toggle-slider';

      toggle.appendChild(checkbox);
      toggle.appendChild(slider);
      inputWrap.appendChild(toggle);

    } else if (ctrl.type === 2) {
      /* ── Select / menu ── */
      const select = document.createElement('select');
      select.className = 'adcs-select';
      select.disabled = ctrl.isInactive;

      const labels = MENU_LABELS[key] || {};
      for (let i = ctrl.min; i <= ctrl.max; i += ctrl.step) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = labels[i] !== undefined ? labels[i] : String(i);
        if (i === ctrl.value) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', async () => {
        const v = parseInt(select.value, 10);
        try {
          await patchControl(camIndex, key, v);
          onChangeCallback(key, v);
        } catch {
          select.value = ctrl.value;
        }
      });
      inputWrap.appendChild(select);

    } else {
      /* ── Integer: slider + number input ── */
      const sliderRow = document.createElement('div');
      sliderRow.className = 'adcs-slider-row';

      const rangeInput = document.createElement('input');
      rangeInput.type = 'range';
      rangeInput.className = 'adcs-range';
      rangeInput.min = ctrl.min;
      rangeInput.max = ctrl.max;
      rangeInput.step = ctrl.step;
      rangeInput.value = ctrl.value;
      rangeInput.disabled = ctrl.isInactive;

      const numberInput = document.createElement('input');
      numberInput.type = 'number';
      numberInput.className = 'adcs-number';
      numberInput.min = ctrl.min;
      numberInput.max = ctrl.max;
      numberInput.step = ctrl.step;
      numberInput.value = ctrl.value;
      numberInput.disabled = ctrl.isInactive;

      let debounceTimer = null;
      function applyValue(v) {
        v = Math.max(ctrl.min, Math.min(ctrl.max, v));
        rangeInput.value = v;
        numberInput.value = v;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            await patchControl(camIndex, key, v);
            onChangeCallback(key, v);
          } catch { /* silently ignore */ }
        }, 200);
      }

      rangeInput.addEventListener('input', () => applyValue(parseInt(rangeInput.value, 10)));
      numberInput.addEventListener('change', () => applyValue(parseInt(numberInput.value, 10)));
      numberInput.addEventListener('input', () => applyValue(parseInt(numberInput.value, 10)));

      sliderRow.appendChild(rangeInput);
      sliderRow.appendChild(numberInput);
      inputWrap.appendChild(sliderRow);
    }

    row.appendChild(inputWrap);
    return row;
  }

  /* ─── Open panel ──────────────────────────────────────────────────── */

  let activePanelCam = null; // index of the cam whose panel is open
  let hiddenCalibrationEls = []; // calibration SVGs hidden while the panel is open

  function closePanel() {
    const existing = document.getElementById('adcs-panel');
    if (existing) existing.remove();
    const overlay = document.getElementById('adcs-overlay');
    if (overlay) overlay.remove();
    // Restore calibration overlays
    for (const { el, display } of hiddenCalibrationEls) {
      el.style.display = display;
    }
    hiddenCalibrationEls = [];
    activePanelCam = null;
  }

  async function openPanel(camIndex, anchorEl) {
    // If same cam clicked twice, close
    if (activePanelCam === camIndex) {
      closePanel();
      return;
    }
    closePanel();
    activePanelCam = camIndex;

    // Dim overlay (click to close)
    const overlay = document.createElement('div');
    overlay.id = 'adcs-overlay';
    overlay.addEventListener('click', closePanel);
    document.body.appendChild(overlay);

    // Panel skeleton
    const panel = document.createElement('div');
    panel.id = 'adcs-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Camera ${camIndex + 1} V4L2 Settings`);

    /* Header */
    const header = document.createElement('div');
    header.className = 'adcs-panel-header';

    const title = document.createElement('span');
    title.className = 'adcs-panel-title';
    title.innerHTML = `<i class="mdi mdi-camera-settings" aria-hidden="true"></i> Camera ${camIndex + 1} Settings`;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'adcs-icon-btn';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '<i class="mdi mdi-close" aria-hidden="true"></i>';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(closeBtn);

    panel.appendChild(header);

    /* Loading state */
    const body = document.createElement('div');
    body.className = 'adcs-panel-body';

    const spinner = document.createElement('div');
    spinner.className = 'adcs-spinner';
    spinner.innerHTML = '<i class="mdi mdi-loading mdi-spin" aria-hidden="true"></i>';
    body.appendChild(spinner);
    panel.appendChild(body);

    /* Footer */
    const footer = document.createElement('div');
    footer.className = 'adcs-panel-footer';

    const resetOpenBtn = document.createElement('button');
    resetOpenBtn.className = 'adcs-btn adcs-btn-secondary';
    resetOpenBtn.innerHTML = '<i class="mdi mdi-restore" aria-hidden="true"></i> Restore previous';
    resetOpenBtn.disabled = true;

    const resetDefaultBtn = document.createElement('button');
    resetDefaultBtn.className = 'adcs-btn adcs-btn-secondary';
    resetDefaultBtn.innerHTML = '<i class="mdi mdi-cog-refresh-outline" aria-hidden="true"></i> Device defaults';
    resetDefaultBtn.disabled = true;

    footer.appendChild(resetOpenBtn);
    footer.appendChild(resetDefaultBtn);
    panel.appendChild(footer);

    document.body.appendChild(panel);

    // Hide the calibration SVG overlay while the settings panel is open
    for (const svgEl of anchorEl.querySelectorAll('svg')) {
      hiddenCalibrationEls.push({ el: svgEl, display: svgEl.style.display });
      svgEl.style.display = 'none';
    }

    // Position panel near the anchor image
    positionPanel(panel, anchorEl);

    /* Fetch controls */
    let controls;
    try {
      controls = await fetchControls(camIndex);
    } catch (e) {
      body.innerHTML = `<div class="adcs-error"><i class="mdi mdi-alert-circle-outline"></i> Failed to load controls: ${e.message}</div>`;
      return;
    }

    // Snapshot of values at open time
    const snapshot = {};
    for (const [k, v] of Object.entries(controls)) {
      snapshot[k] = v.value;
    }

    // Track live values
    const liveValues = { ...snapshot };

    /* Render controls */
    body.innerHTML = '';

    // Group controls: booleans / menus first, then sliders
    const sorted = Object.entries(controls).sort(([, a], [, b]) => {
      // booleans and menus before sliders
      const aOrder = a.type === 0 ? 1 : 0;
      const bOrder = b.type === 0 ? 1 : 0;
      return aOrder - bOrder || a.name.localeCompare(b.name);
    });

    async function refreshDisabledStates() {
      let freshControls;
      try { freshControls = await fetchControls(camIndex); } catch { return; }
      for (const [k, ctrl] of Object.entries(freshControls)) {
        const row = body.querySelector(`[data-adcs-key="${k}"]`);
        if (!row) continue;
        row.classList.toggle('adcs-inactive', !!ctrl.isInactive);
        for (const inp of row.querySelectorAll('input, select')) {
          inp.disabled = !!ctrl.isInactive;
        }
      }
    }

    for (const [key, ctrl] of sorted) {
      const row = buildControlRow(key, ctrl, camIndex, (k, v) => {
        liveValues[k] = v;
        // Re-fetch disabled states when a toggle or menu changes (may affect other controls)
        if (controls[k] && controls[k].type !== 0) {
          refreshDisabledStates();
        }
      });
      body.appendChild(row);
    }

    /* Enable footer buttons */
    resetOpenBtn.disabled = false;
    resetDefaultBtn.disabled = false;

    resetOpenBtn.addEventListener('click', async () => {
      resetOpenBtn.disabled = true;
      try {
        for (const [key, value] of Object.entries(snapshot)) {
          await patchControl(camIndex, key, value);
        }
        // Re-open with refreshed values
        closePanel();
        openPanel(camIndex, anchorEl);
      } catch {
        resetOpenBtn.disabled = false;
      }
    });

    resetDefaultBtn.addEventListener('click', async () => {
      resetDefaultBtn.disabled = true;
      try {
        await resetControls(camIndex);
        closePanel();
        openPanel(camIndex, anchorEl);
      } catch {
        resetDefaultBtn.disabled = false;
      }
    });

    // Re-position after content loaded (height may have changed)
    positionPanel(panel, anchorEl);
  }

  function positionPanel(panel, anchorEl) {
    // Try to place panel to the right of the anchor; fall back to below
    const rect = anchorEl.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const PANEL_W = 400;
    const GAP = 12;

    let left = rect.right + scrollX + GAP;
    let top = rect.top + scrollY;

    // If no room to the right, try left
    if (left + PANEL_W > scrollX + vw - GAP) {
      left = rect.left + scrollX - PANEL_W - GAP;
    }
    // If still off-screen, centre under the anchor
    if (left < scrollX + GAP) {
      left = rect.left + scrollX + rect.width / 2 - PANEL_W / 2;
      left = Math.max(scrollX + GAP, Math.min(left, scrollX + vw - PANEL_W - GAP));
      top = rect.bottom + scrollY + GAP;
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.width = `${PANEL_W}px`;
  }

  /* ─── Inject click handlers on the camera image zone ──────────────── */

  function injectOnCamImages() {
    const imgs = document.querySelectorAll('img[src*="/api/streams/cams/"]');
    imgs.forEach((img) => {
      if (img.dataset.adcsAttached) return;
      img.dataset.adcsAttached = '1';

      // Parse cam index from URL
      const match = img.src.match(/\/api\/streams\/cams\/(\d+)/);
      if (!match) return;
      const camIndex = parseInt(match[1], 10);

      // level2 = parent of the img wrapper — contains the stream div + calibration
      // SVG overlay but NO buttons/selects, so the whole area is safe to click.
      const imageZone = img.parentElement?.parentElement || img.parentElement;
      imageZone.classList.add('adcs-cam-card');
      imageZone.style.position = 'relative';

      // Small badge pinned to the top-right corner of the image
      const badge = document.createElement('div');
      badge.className = 'adcs-cam-badge';
      badge.innerHTML = '<i class="mdi mdi-tune" aria-hidden="true"></i>';
      imageZone.appendChild(badge);

      // Clicks on the SVG calibration overlay bubble up to imageZone
      imageZone.addEventListener('click', (e) => {
        e.stopPropagation();
        openPanel(camIndex, imageZone);
      });
    });
  }

  /* ─── SPA-navigation aware startup ───────────────────────────────── */

  let _lastPath = location.pathname;

  /** True on the board config page — both the directly-served board
   * (`/config`) and the embedded client on play.autodarts.io
   * (`/boards/<id>/config`). */
  function isConfigPage() {
    return location.pathname === '/config'
      || /^\/boards\/[0-9a-fA-F-]+\/config$/.test(location.pathname);
  }

  /** Called whenever the URL is (or becomes) the config page, or when we leave it. */
  function onUrlChange() {
    if (isConfigPage()) {
      injectMDI();
      injectOnCamImages();
    } else {
      closePanel();
    }
  }

  // Single persistent MutationObserver — catches React's async rendering of
  // camera images after every SPA navigation to the config page.
  // We also observe `src` attribute changes: React often inserts <img> elements
  // first and sets their src asynchronously, so childList alone isn't enough.
  let _injectTimer = null;
  function scheduleInject() {
    if (_injectTimer) clearTimeout(_injectTimer);
    _injectTimer = setTimeout(injectOnCamImages, 80);
  }

  const _observer = new MutationObserver(() => {
    if (isConfigPage()) {
      scheduleInject();
    }
  });

  function start() {
    _observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    // history.pushState cannot be intercepted from a content script's isolated
    // world, so we poll location.pathname to reliably detect SPA route changes.
    setInterval(() => {
      const path = location.pathname;
      if (path !== _lastPath) {
        _lastPath = path;
        onUrlChange();
      }
    }, 250);

    // popstate fires for back/forward navigation and is accessible from the
    // isolated world.
    window.addEventListener('popstate', () => {
      _lastPath = location.pathname;
      onUrlChange();
    });

    // Initial check
    onUrlChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
