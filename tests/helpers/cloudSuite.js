'use strict';

/**
 * Shared test suite for the Autodarts cloud client.
 *
 * The cloud client is served from both play.autodarts.com (current) and
 * play.autodarts.io (legacy, still 301-redirecting), so the same expectations
 * have to hold on either origin. jsdom fixes the page URL per test file via the
 * `@jest-environment-options` docblock, hence one thin test file per host that
 * calls into this suite.
 *
 * On the cloud the config page lives at /boards/<id>/config and the page origin
 * does NOT serve the camera API. The board is reached through its per-board
 * relay host (…autodarts.direct), whose origin the camera stream <img> already
 * uses — so the API base is derived from that image's origin, independent of
 * which cloud domain serves the page.
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

/**
 * Register the cloud-client tests for the host currently served by jsdom.
 * @param {string} cloudHost the expected page host, e.g. 'play.autodarts.com'
 */
function runCloudSuite(cloudHost) {
  describe(`cloud client on ${cloudHost}`, () => {
    beforeEach(() => {
      // Guard against a mismatched docblock silently testing the wrong origin.
      expect(location.host).toBe(cloudHost);
      jest.resetModules();
      mockFetch();
    });

    afterEach(() => {
      document.body.innerHTML = '';
      jest.restoreAllMocks();
    });

    test('injects the badge on the /boards/<id>/config path', () => {
      setupDOM(2);
      require('../../src/content.js');
      expect(document.querySelectorAll('.adcs-cam-badge').length).toBe(2);
    });

    test('fetches controls from the autodarts.direct relay host, not the cloud origin', async () => {
      setupDOM();
      require('../../src/content.js');
      clickCard();
      await tick();
      const controlsCall = global.fetch.mock.calls
        .find(([url]) => url.includes('/api/cams/controls/'));
      expect(controlsCall).toBeDefined();
      expect(controlsCall[0]).toBe(`${RELAY_BASE}/api/cams/controls/0`);
      expect(controlsCall[0]).not.toContain(cloudHost);
    });

    test('PATCHes to the relay host when a control changes', async () => {
      setupDOM();
      require('../../src/content.js');
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
      require('../../src/content.js');
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
        require('../../src/content.js');
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
  });
}

module.exports = { runCloudSuite, BOARD_ID, RELAY_BASE, MOCK_CONTROLS };
