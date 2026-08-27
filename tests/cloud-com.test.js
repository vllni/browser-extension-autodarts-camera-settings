/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://play.autodarts.com/boards/2e0fbbcd-3148-4e6e-bcfc-84d013426f82/config"}
 */

'use strict';

/** Cloud client on the current domain (play.autodarts.com). */
require('./helpers/cloudSuite').runCloudSuite('play.autodarts.com');
