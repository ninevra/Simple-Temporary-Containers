/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { App } from './app.js';

// Construct application state
const app = new App();
// Wire up event listeners
app.connect();
// Expose state to the integration tests
window.app = app;
