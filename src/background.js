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

// Setup & Register Event Handlers:

browser.tabs.onRemoved.addListener(removeEmptyTemporaryContainers);
browser.tabs.onCreated.addListener(handleTabCreated);
browser.browserAction.onClicked.addListener(handleBrowserAction);
browser.contextualIdentities.onCreated.addListener(handleContainerCreated);
browser.runtime.onStartup.addListener(removeEmptyTemporaryContainers);
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
async function removeEmptyTemporaryContainers(removedTabId) {
  console.time('removeEmptyTempContainers');
  // Check all extant containers
  const allContainers = await browser.contextualIdentities.query({});
  await Promise.all(
    allContainers.map(async (container) => {
      if (
        isMarkedContainer(container) ||
        (await isManagedContainer(container))
      ) {
        const { cookieStoreId } = container;
        const tabs = await browser.tabs.query({ cookieStoreId });
        const stillOpenTabs = tabs.filter(({ id }) => id !== removedTabId);
        if (stillOpenTabs.length === 0) {
          await browser.contextualIdentities.remove(cookieStoreId);
        }
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
