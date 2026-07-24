/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://play.autodarts.io/boards/2e0fbbcd-3148-4e6e-bcfc-84d013426f82/config"}
 */

'use strict';

/**
 * Tests for the play.autodarts.io embedded client.
 *
 * On the cloud the config page lives at /boards/<id>/config and the page origin
 * (play.autodarts.io) does NOT serve the camera API. The board is reached
 * through its per-board relay host, whose origin the camera stream <img>
 * already uses — so the API base is derived from that image's origin.
 */

const BOARD_ID = '2e0fbbcd-3148-4e6e-bcfc-84d013426f82';
const RELAY_BASE = `https://192-168-178-46.${BOARD_ID}.autodarts.direct:3181`;

const MOCK_CONTROLS = {
  brightness: {
    name: 'Brightness',
    min: -64, max: 64, default: 0, value: 10, step: 1,
    isInactive: false, type: 0,
  },
};

function setupDOM(camCount = 1) {
  const cameras = Array.from({ length: camCount }, (_, i) => `
    <div class="outer-card">
      <div class="image-zone">
        <div class="img-wrapper">
          <img src="${RELAY_BASE}/api/streams/cams/${i}">
        </div>
      </div>
    </div>
  `).join('');
  document.body.innerHTML = cameras;
}

function mockFetch() {
  global.fetch = jest.fn((url, opts) => {
    if (!opts || !opts.method || opts.method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_CONTROLS) });
    }
    return Promise.resolve({ ok: true });
  });
}

function clickCard(index = 0) {
  document.querySelectorAll('.adcs-cam-card')[index]
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  jest.resetModules();
  mockFetch();
});

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

test('injects the badge on the /boards/<id>/config path', () => {
  setupDOM(2);
  require('../src/content.js');
  expect(document.querySelectorAll('.adcs-cam-badge').length).toBe(2);
});

test('fetches controls from the autodarts.direct relay host, not the cloud origin', async () => {
  setupDOM();
  require('../src/content.js');
  clickCard();
  await tick();
  const controlsCall = global.fetch.mock.calls
    .find(([url]) => url.includes('/api/cams/controls/'));
  expect(controlsCall).toBeDefined();
  expect(controlsCall[0]).toBe(`${RELAY_BASE}/api/cams/controls/0`);
  expect(controlsCall[0]).not.toContain('play.autodarts.io');
});

test('PATCHes to the relay host when a control changes', async () => {
  setupDOM();
  require('../src/content.js');
  clickCard();
  await tick();

  const range = document.querySelector('input[type="range"]');
  range.value = '5';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(300); // debounce is 200ms

  const patchCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PATCH');
  expect(patchCall).toBeDefined();
  expect(patchCall[0]).toBe(`${RELAY_BASE}/api/cams/controls/0`);
});

test('renders the control panel with cloud-resolved controls', async () => {
  setupDOM();
  require('../src/content.js');
  clickCard();
  await tick();
  expect(document.querySelectorAll('.adcs-control-row').length)
    .toBe(Object.keys(MOCK_CONTROLS).length);
});

describe('with an extension runtime available (background delegation)', () => {
  afterEach(() => { delete global.browser; });

  test('routes the cross-origin controls request through the background script', async () => {
    global.browser = {
      runtime: {
        sendMessage: jest.fn(() => Promise.resolve({
          ok: true, status: 200, body: JSON.stringify(MOCK_CONTROLS),
        })),
      },
    };
    setupDOM();
    require('../src/content.js');
    clickCard();
    await tick();

    // The cross-origin GET must go via runtime messaging, not a direct fetch.
    const msg = global.browser.runtime.sendMessage.mock.calls[0][0];
    expect(msg.type).toBe('adcs-api');
    expect(msg.url).toBe(`${RELAY_BASE}/api/cams/controls/0`);
    const directControlsFetch = global.fetch.mock.calls
      .find(([url]) => typeof url === 'string' && url.includes('/api/cams/controls/'));
    expect(directControlsFetch).toBeUndefined();
    // Panel still renders from the background-provided body.
    expect(document.querySelectorAll('.adcs-control-row').length)
      .toBe(Object.keys(MOCK_CONTROLS).length);
  });
});
