/**
 * Autodarts Camera Settings – background script
 *
 * Performs board API requests on behalf of the content script.
 *
 * Why this exists: on play.autodarts.io the board is reached through its
 * per-board relay host (…autodarts.direct), and that host's /api/cams/*
 * responses do NOT include an Access-Control-Allow-Origin header. A fetch made
 * from the content script runs in the page's origin and is therefore blocked by
 * CORS ("NetworkError"). A fetch made here, from the extension, is CORS-exempt
 * because the extension holds host permission for *.autodarts.direct — so the
 * content script delegates cross-origin requests to us via runtime messaging.
 */

const ext = (typeof browser !== 'undefined') ? browser : chrome;

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'adcs-api' || !msg.url) return;

  (async () => {
    try {
      const res = await fetch(msg.url, msg.init || {});
      const body = await res.text();
      sendResponse({ ok: res.ok, status: res.status, body });
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse
});
