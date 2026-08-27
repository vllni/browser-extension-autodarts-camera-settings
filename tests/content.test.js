'use strict';

/**
 * Tests for content.js
 *
 * Strategy: set up a jsdom DOM with camera stream images, then require()
 * the content script (which auto-runs its IIFE). Because jest.resetModules()
 * is called in beforeEach, each test gets a fresh execution of the script.
 *
 * fetch is mocked globally before each test.
 */

const MOCK_CONTROLS = {
  brightness: {
    name: 'Brightness',
    min: -64, max: 64, default: 0, value: 10, step: 1,
    isInactive: false, type: 0,
  },
  autoWhiteBalance: {
    name: 'White Balance, Automatic',
    min: 0, max: 1, default: 1, value: 1, step: 1,
    isInactive: false, type: 1,
  },
  exposureAuto: {
    name: 'Auto Exposure',
    min: 0, max: 3, default: 3, value: 3, step: 1,
    isInactive: false, type: 2,
  },
  exposureAbsolute: {
    name: 'Exposure Time, Absolute',
    min: 50, max: 10000, default: 166, value: 166, step: 1,
    isInactive: true, type: 0,
  },
};

/** DOM with one camera stream image (two wrapper divs, as on the real page). */
function setupDOM(camCount = 1) {
  const cameras = Array.from({ length: camCount }, (_, i) => `
    <div class="outer-card">
      <div class="image-zone">
        <div class="img-wrapper">
          <img src="http://192.168.178.46:3180/api/streams/cams/${i}">
        </div>
      </div>
      <div class="controls-row">
        <button>Flip</button>
        <select><option>Camera ${i}</option></select>
      </div>
    </div>
  `).join('');
  document.body.innerHTML = cameras;
}

/** Make fetch return the given controls for any GET, and 200 for PATCH/POST. */
function mockFetch(controls = MOCK_CONTROLS) {
  global.fetch = jest.fn((url, opts) => {
    if (!opts || opts.method === 'GET' || !opts.method) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(controls),
      });
    }
    return Promise.resolve({ ok: true });
  });
}

/** Open the panel by dispatching a click on the first .adcs-cam-card. */
function clickCard(index = 0) {
  const cards = document.querySelectorAll('.adcs-cam-card');
  cards[index].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Wait for async fetch + rendering. */
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  jest.resetModules();
  mockFetch();
});

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

/** /api/devices as a Linux board reports it (V4L2 device paths). */
const LINUX_DEVICES = [{
  card: 'USB HD Camera: USB HD Camera',
  bus: 'usb-0000:01:00.0-1.2',
  formats: [{ path: '/dev/video0', name: 'MJPG', resolutions: [] }],
}];

/** /api/devices as a macOS board reports it: bare index, AVFoundation bus id. */
const MACOS_DEVICES = [{
  card: 'Autodarts DIY Cam',
  bus: '0x11200000c451915',
  formats: [{ path: '0', name: 'NV12', resolutions: [] }],
}];

/** Board that 404s every camera-controls request, with the given /api/devices. */
function mockFetch404WithDevices(devices) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/devices')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(devices) });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

// ─── Board without V4L2 (macOS) ────────────────────────────────────────────

describe('board whose cameras are not V4L2 devices', () => {
  test('explains the platform instead of showing HTTP 404', async () => {
    setupDOM();
    mockFetch404WithDevices(MACOS_DEVICES);
    require('../src/content.js');
    clickCard();
    await tick();

    const err = document.querySelector('.adcs-error');
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/not running on Linux/i);
    expect(err.textContent).not.toMatch(/HTTP 404/);
  });

  test('a Linux board that 404s still reports the URL, not the platform', async () => {
    setupDOM();
    mockFetch404WithDevices(LINUX_DEVICES);
    require('../src/content.js');
    clickCard();
    await tick();

    const err = document.querySelector('.adcs-error');
    expect(err.textContent).toContain('/api/cams/controls/0');
    expect(err.textContent).not.toMatch(/not running on Linux/i);
  });

  test('an unreadable /api/devices does not claim a platform', async () => {
    setupDOM();
    global.fetch = jest.fn((url) => (String(url).includes('/api/devices')
      ? Promise.resolve({ ok: false, status: 500 })
      : Promise.resolve({ ok: false, status: 404 })));
    require('../src/content.js');
    clickCard();
    await tick();

    const err = document.querySelector('.adcs-error');
    expect(err.textContent).toContain('/api/cams/controls/0');
    expect(err.textContent).not.toMatch(/Linux/i);
  });
});

// ─── Badge / card injection ────────────────────────────────────────────────

describe('badge injection', () => {
  test('injects one badge per camera image', () => {
    setupDOM(3);
    require('../src/content.js');
    expect(document.querySelectorAll('.adcs-cam-badge').length).toBe(3);
  });

  test('marks each image as attached', () => {
    setupDOM(2);
    require('../src/content.js');
    const imgs = document.querySelectorAll('img[src*="/api/streams/cams/"]');
    imgs.forEach((img) => expect(img.dataset.adcsAttached).toBe('1'));
  });

  test('does not double-attach when init runs twice', () => {
    setupDOM(1);
    require('../src/content.js');
    // Simulate MutationObserver re-triggering injectOnCamImages
    // by dispatching a DOM mutation (adding a node triggers the observer)
    const dummy = document.createElement('div');
    document.body.appendChild(dummy);
    // Give the observer a tick to fire
    return tick(10).then(() => {
      expect(document.querySelectorAll('.adcs-cam-badge').length).toBe(1);
    });
  });

  test('badge is inside the image zone, not the outer card with buttons', () => {
    setupDOM(1);
    require('../src/content.js');
    const badge = document.querySelector('.adcs-cam-badge');
    // The image zone (.adcs-cam-card) must NOT contain any <button>
    expect(badge.closest('.adcs-cam-card').querySelector('button')).toBeNull();
  });
});

// ─── Panel open / close ────────────────────────────────────────────────────

describe('panel open / close', () => {
  test('clicking image zone opens the panel', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    expect(document.getElementById('adcs-panel')).not.toBeNull();
  });

  test('panel has correct aria-label', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    expect(document.getElementById('adcs-panel').getAttribute('aria-label'))
      .toBe('Camera 1 V4L2 Settings');
  });

  test('clicking same card twice closes the panel', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    expect(document.getElementById('adcs-panel')).not.toBeNull();
    clickCard();
    expect(document.getElementById('adcs-panel')).toBeNull();
  });

  test('clicking the overlay closes the panel', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    document.getElementById('adcs-overlay')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('adcs-panel')).toBeNull();
    expect(document.getElementById('adcs-overlay')).toBeNull();
  });

  test('clicking the close button closes the panel', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    document.querySelector('.adcs-icon-btn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('adcs-panel')).toBeNull();
  });

  test('opening a second camera closes the first panel', async () => {
    setupDOM(2);
    require('../src/content.js');
    clickCard(0);
    await tick();
    expect(document.getElementById('adcs-panel')).not.toBeNull();
    clickCard(1);
    await tick();
    // Panel still exists but is now for cam 2
    const panel = document.getElementById('adcs-panel');
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('aria-label')).toBe('Camera 2 V4L2 Settings');
  });
});

// ─── Control rendering ─────────────────────────────────────────────────────

describe('control rendering', () => {
  test('renders one row per control', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    expect(document.querySelectorAll('.adcs-control-row').length)
      .toBe(Object.keys(MOCK_CONTROLS).length);
  });

  test('renders range + number input for integer controls (type 0)', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    expect(document.querySelectorAll('input[type="range"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('input[type="number"]').length).toBeGreaterThan(0);
  });

  test('renders a checkbox toggle for boolean controls (type 1)', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    const checkboxes = document.querySelectorAll('.adcs-toggle input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  test('boolean toggle reflects current value', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    // autoWhiteBalance value=1 → checked
    const checkbox = document.querySelector('.adcs-toggle input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
  });

  test('renders a <select> for menu controls (type 2)', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    const selects = document.querySelectorAll('.adcs-select');
    expect(selects.length).toBeGreaterThan(0);
  });

  test('integer range input reflects current value', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    const range = document.querySelector('input[type="range"]');
    // brightness.value = 10
    expect(parseInt(range.value, 10)).toBe(10);
  });

  test('inactive controls have the adcs-inactive class and disabled inputs', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();
    const inactiveRows = document.querySelectorAll('.adcs-inactive');
    expect(inactiveRows.length).toBeGreaterThan(0);
    inactiveRows.forEach((row) => {
      row.querySelectorAll('input, select').forEach((el) => {
        expect(el.disabled).toBe(true);
      });
    });
  });

  test('shows error message when fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick(100);
    expect(document.querySelector('.adcs-error')).not.toBeNull();
  });
});

// ─── API calls ────────────────────────────────────────────────────────────

describe('API calls', () => {
  test('fetches controls for the correct camera index', async () => {
    setupDOM(3);
    require('../src/content.js');
    clickCard(1); // second camera → cam index 1
    await tick();
    const getCall = global.fetch.mock.calls.find(
      ([url, opts]) => !opts || !opts.method || opts.method === 'GET'
    );
    expect(getCall[0]).toMatch(/\/api\/cams\/controls\/1$/);
  });

  test('PATCHes the correct endpoint when a range input changes', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();

    const range = document.querySelector('input[type="range"]');
    range.value = '5';
    range.dispatchEvent(new Event('input', { bubbles: true }));

    await tick(300); // debounce is 200ms
    const patchCall = global.fetch.mock.calls.find(
      ([, opts]) => opts?.method === 'PATCH'
    );
    expect(patchCall).toBeDefined();
    expect(patchCall[0]).toMatch(/\/api\/cams\/controls\/0$/);
    expect(patchCall[1].headers['Content-Type']).toBe('application/json');
  });

  test('PATCHes when a toggle changes', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();

    const checkbox = document.querySelector('.adcs-toggle input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    await tick(50);
    const patchCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall[1].body);
    expect(Object.values(body)[0]).toBe(0);
  });

  test('POSTs to /reset when "Device defaults" is clicked', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();

    const defaultsBtn = Array.from(document.querySelectorAll('.adcs-btn'))
      .find((b) => b.textContent.includes('Device defaults'));
    defaultsBtn.click();
    await tick(50);

    const resetCall = global.fetch.mock.calls.find(([url, opts]) => opts?.method === 'POST');
    expect(resetCall[0]).toMatch(/\/api\/cams\/controls\/0\/reset$/);
  });
});

// ─── Restore previous ─────────────────────────────────────────────────────

describe('restore previous', () => {
  test('PATCHes all controls with their original snapshot values', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();

    global.fetch.mockClear();

    const restoreBtn = Array.from(document.querySelectorAll('.adcs-btn'))
      .find((b) => b.textContent.includes('Restore previous'));
    restoreBtn.click();
    await tick(200);

    const patchCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PATCH');
    expect(patchCalls.length).toBe(Object.keys(MOCK_CONTROLS).length);
  });

  test('restores snapshot values, not modified values', async () => {
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();

    // Simulate user changing brightness to 99
    const range = document.querySelector('input[type="range"]');
    range.value = '99';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(300);

    global.fetch.mockClear();

    const restoreBtn = Array.from(document.querySelectorAll('.adcs-btn'))
      .find((b) => b.textContent.includes('Restore previous'));
    restoreBtn.click();
    await tick(200);

    const brightnessPatch = global.fetch.mock.calls.find(([, opts]) => {
      if (opts?.method !== 'PATCH') return false;
      const body = JSON.parse(opts.body);
      return 'brightness' in body;
    });
    expect(brightnessPatch).toBeDefined();
    // Should restore original value (10), not the modified value (99)
    expect(JSON.parse(brightnessPatch[1].body).brightness).toBe(10);
  });
});
