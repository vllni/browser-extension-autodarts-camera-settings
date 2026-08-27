/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://play.autodarts.io/boards/2e0fbbcd-3148-4e6e-bcfc-84d013426f82/config"}
 */

'use strict';

/**
 * Cloud client on the legacy domain (play.autodarts.io), which currently
 * 301-redirects to play.autodarts.com and is slated for shutdown.
 *
 * Kept only as a guard for users who reach the client before the redirect
 * (old bookmarks, cached SPA sessions). Nothing in the extension is
 * domain-specific, so this file can simply be deleted once .io is switched
 * off — no source change is needed at that point.
 */
require('./helpers/cloudSuite').runCloudSuite('play.autodarts.io');
