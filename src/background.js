/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  genName,
  isManagedContainer,
  isMarkedContainer,
  makeContainerTemporary,
} from './container-util.js';
import { tabColor, tabColors, nextTab, rightmostTab } from './tab-util.js';
import { randomColor, debug } from './util.js';

// Event handlers

// Handles extension being installed, reinstalled, or updated
async function handleInstalled(details) {
  if (details.temporary) {
    // Run tests
    await browser.tabs.create({ url: '/test/test.html' });
  }
}

// Handles tabs being opened
async function handleTabCreated(tab) {
  const { cookieStoreId } = tab;
  if (cookieStoreId !== 'firefox-default') {
    const container = await browser.contextualIdentities.get(cookieStoreId);
    if (isMarkedContainer(container)) {
      await makeContainerTemporary(container);
    }
  }
}

async function handleContainerCreated({ contextualIdentity: container }) {
  if (isMarkedContainer(container)) {
    await makeContainerTemporary(container);
  }
}

// Handles the browserAction being clicked
// Create a new container and an empty tab in that container
async function handleBrowserAction(activeTab) {
  // Tab will be created at end of window. banned colors: last tab in
  // window, current active tab
  const denyList = await tabColors(
    activeTab,
    await rightmostTab(activeTab.windowId)
  );
  const container = await createContainer(denyList);
  await browser.tabs.create({
    cookieStoreId: container.cookieStoreId,
  });
}

// Handles the menu item being clicked
// Open a new container and a new tab with the given link
async function handleMenuItem(info, tab) {
  // IDEA: Handle srcUrls as well? would require registering the 'image' context
  // QUESTION: Can tab parameter ever be missing in the registered contexts??
  if (info.menuItemId === 'new-temp-container-tab') {
    // Tab will be created after this tab. banned colors: this tab, next tab
    const denyList = [];
    if (tab) {
      denyList.push(await tabColor(tab));
      const next = await nextTab(tab);
      if (next) {
        denyList.push(await tabColor(next));
      }
    }

    const container = await createContainer(denyList);
    await browser.tabs.create({
      cookieStoreId: container.cookieStoreId,
      url: info.linkUrl,
      index: tab ? tab.index + 1 : undefined,
      active: false,
    });
  } else if (info.menuItemId === 'reopen-in-new-temp-container') {
    // Tab will be created after this tab. banned colors: this tab, next tab
    const denyList = [await tabColor(tab)];
    const next = await nextTab(tab);
    if (next) {
      denyList.push(await tabColor(next));
    }

    const container = await createContainer(denyList);
    await browser.tabs.create({
      cookieStoreId: container.cookieStoreId,
      url: info.pageUrl,
      index: tab.index + 1,
      active: tab.active,
    });
  }
}

const recentlyRemovedTabIds = new Set();

// Delay in milliseconds between tab deletion and container deletion
const CLEANUP_DELAY_MS = 10_000;
// The id of the timer for the scheduled cleanup operation
let debounceTimer;

async function clean() {
  // Clear any old timer
  window.clearTimeout(debounceTimer);
  // Start a new timer
  debounceTimer = window.setTimeout(async () => {
    await removeEmptyTemporaryContainers(recentlyRemovedTabIds);
    recentlyRemovedTabIds.clear();
  }, CLEANUP_DELAY_MS);
}

// Setup & Register Event Handlers:

browser.tabs.onRemoved.addListener(async (id) => {
  recentlyRemovedTabIds.add(id);
  await clean();
});
browser.tabs.onCreated.addListener(handleTabCreated);
browser.browserAction.onClicked.addListener(handleBrowserAction);
browser.contextualIdentities.onCreated.addListener(handleContainerCreated);
browser.runtime.onInstalled.addListener(handleInstalled);

browser.menus.create(
  {
    contexts: ['link'],
    id: 'new-temp-container-tab',
    title: 'Open Link in New Te&mp Container Tab',
    // Prevents menu item on e.g. javascript://
    // TODO: somewhat overzealous
    documentUrlPatterns: ['<all_urls>'],
  },
  () => {
    if (browser.runtime.lastError) {
      console.error(
        'Error encountered while creating link context menu item',
        browser.runtime.lastError
      );
    }
  }
);
browser.menus.create(
  {
    contexts: ['tab'],
    id: 'reopen-in-new-temp-container',
    title: 'Reopen in New &Temp Container',
    documentUrlPatterns: ['<all_urls>'],
  },
  () => {
    if (browser.runtime.lastError) {
      console.error(
        'Error encountered while creating tab context menu item',
        browser.runtime.lastError
      );
    }
  }
);

browser.menus.onClicked.addListener(handleMenuItem);

// State Operations:

// Creates, records, and returns a new temporary container
async function createContainer(denyList = []) {
  const color = randomColor(...denyList);
  const container = await browser.contextualIdentities.create({
    name: 'Temp',
    color,
    icon: 'circle',
  });
  const cookieStoreId = container.cookieStoreId;
  const name = await genName(container);
  await browser.contextualIdentities.update(cookieStoreId, { name });
  debug.log('created container', cookieStoreId);
  return container;
}

// Iterates through all containers and tabs to rebuild extension state
async function removeEmptyTemporaryContainers(
  recentlyRemovedTabIds = new Set()
) {
  console.time('removeEmptyTempContainers');
  // Retrieve containers before tabs
  // Therefore containers added after tabs are queried are preserved
  const allContainers = await browser.contextualIdentities.query({});
  const managedState = await Promise.all(
    allContainers.map(async (container) => [
      container,
      isMarkedContainer(container) || (await isManagedContainer(container)),
    ])
  );
  const managedContainers = managedState
    .filter(([, isManaged]) => isManaged)
    .map(([container]) => container);
  // Query tabs
  // This may be inconsistent; recently removed tabs sometimes persist
  const allTabs = await browser.tabs.query({});
  const realTabs = allTabs.filter(({ id }) => !recentlyRemovedTabIds.has(id));
  // Synchronously find the empty containers
  const nonEmptyContainers = new Set(realTabs.map((tab) => tab.cookieStoreId));
  const emptyContainers = managedContainers.filter(
    ({ cookieStoreId }) => !nonEmptyContainers.has(cookieStoreId)
  );
  await Promise.all(
    emptyContainers.map(async (container) => {
      // TODO hopefully we've been sync since browser.tabs.query()? but it's
      // likely possible for there to be new tabs not reflected in the query().
      try {
        await browser.contextualIdentities.remove(container.cookieStoreId);
      } catch (error) {
        // TODO why and when does this happen
        console.error('threw while removing', container, error);
      }
    })
  );
  console.timeEnd('removeEmptyTempContainers');
}

// Expose state to the integration tests
window.stateForTests = {
  removeEmptyTemporaryContainers,
  handleBrowserAction,
  handleMenuItem,
  createContainer,
  handleInstalled,
};
