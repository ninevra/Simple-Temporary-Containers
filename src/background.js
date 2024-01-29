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

// State

// A Map whose keys are the cookieStoreIds of all containers managed here
// and whose values are Sets of all tabIds open in the container
const containers = new Map();
// A Map from tabIds to cookieStoreIds of all tabs managed by this extension
const tabs = new Map();

// Event handlers

// Handles browser starting with the extension installed
// TODO: verify this is called correctly
async function handleStartup() {
  await rebuildDatabase();
}

// Handles extension being installed, reinstalled, or updated
async function handleInstalled(details) {
  // QUESTION: if this is an update, does the data still exist?
  await rebuildDatabase();
  if (details.temporary) {
    // Run tests
    await browser.tabs.create({ url: '/test/test.html' });
  }
}

// Handles tabs being opened
// If the tab belongs to a recorded container, then records the tab
async function handleTabCreated(tab) {
  const { cookieStoreId } = tab;
  if (containers.has(cookieStoreId)) {
    addTabToDb(tab);
  } else if (cookieStoreId !== 'firefox-default') {
    const container = await browser.contextualIdentities.get(cookieStoreId);
    if (isMarkedContainer(container)) {
      addContainerToDb(cookieStoreId);
      addTabToDb(tab);
      await makeContainerTemporary(container);
    }
  }
}

async function handleContainerCreated({ contextualIdentity: container }) {
  if (isMarkedContainer(container)) {
    addContainerToDb(container.cookieStoreId);
    await makeContainerTemporary(container);
  }
}

// Handles tabs being closed
// If the tab was recorded, then forget it
// If the tab's container is now empty, then forget and destroy it
async function handleTabRemoved(tabId, _removeInfo) {
  // TODO: handle unexpected cases where container not recorded or doesn't
  // record the tab
  if (tabs.has(tabId)) {
    const cookieStoreId = tabs.get(tabId);
    forgetTab(tabId, cookieStoreId);
    if (isEmptyContainer(cookieStoreId)) {
      await forgetAndRemoveContainer(cookieStoreId);
    }
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

// If a managed container's name has been changed by the user, unmanage it
async function handleIdentityUpdated({ contextualIdentity: container }) {
  debug.log('Continer updated', container);
  if (
    containers.has(container.cookieStoreId) &&
    !(await isManagedContainer(container))
  ) {
    forgetContainer(container.cookieStoreId);
  }
}

// Setup & Register Event Handlers:

browser.tabs.onRemoved.addListener(handleTabRemoved);
browser.tabs.onCreated.addListener(handleTabCreated);
browser.browserAction.onClicked.addListener(handleBrowserAction);
browser.contextualIdentities.onCreated.addListener(handleContainerCreated);
browser.contextualIdentities.onUpdated.addListener(handleIdentityUpdated);
browser.runtime.onStartup.addListener(handleStartup);
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
  addContainerToDb(container.cookieStoreId);
  debug.log('created container', cookieStoreId);
  return container;
}

// Iterates through all containers and tabs to rebuild extension state
async function rebuildDatabase() {
  console.time('rebuildDatabase');
  // TODO: if this takes awhile, the results could be inconsistent, because a
  // tab could be removed before it is registered.  Unfortunately,
  // tabs.onRemoved() can be a tab's first lifecycle event, as when the
  // extension is reloaded or the browser restarted with a managed tab already
  // open.
  // Wipe previous data // QUESTION: can there ever be any?
  containers.clear();
  tabs.clear();
  // Check all extant containers
  const [allContainers, allTabs] = await Promise.all([
    browser.contextualIdentities.query({}),
    browser.tabs.query({}),
  ]);
  await Promise.all(
    allContainers.map(async (container) => {
      const { cookieStoreId } = container;
      if (isMarkedContainer(container)) {
        addContainerToDb(cookieStoreId);
        await makeContainerTemporary(container);
      } else if (await isManagedContainer(container)) {
        addContainerToDb(cookieStoreId);
      }
    })
  );
  for (const tab of allTabs) {
    if (containers.has(tab.cookieStoreId)) {
      addTabToDb(tab);
    }
  }

  await Promise.all(
    [...containers.keys()].map(async (cookieStoreId) => {
      if (isEmptyContainer(cookieStoreId)) {
        await forgetAndRemoveContainer(cookieStoreId);
      }
    })
  );
  console.timeEnd('rebuildDatabase');
  debug.log('Rebuilt database is', containers, tabs);
}

// Records a tab in the extension state
// TODO: handle case where tab is not in a known container
function addTabToDb(tab) {
  debug.log('Recording tab', tab.id, 'in container', tab.cookieStoreId);
  tabs.set(tab.id, tab.cookieStoreId);
  containers.get(tab.cookieStoreId).add(tab.id);
}

// Records a container in the extension state
function addContainerToDb(cookieStoreId) {
  debug.log('Recording temporary container:', cookieStoreId);
  // TODO: this check should always be true
  if (!containers.has(cookieStoreId)) {
    containers.set(cookieStoreId, new Set());
  }
}

// Forgets a tab from the extension state
// TODO: handle case where tab is not in a known container
function forgetTab(tabId, cookieStoreId) {
  debug.log('Forgetting tab', tabId, 'in container', cookieStoreId);
  tabs.delete(tabId);
  containers.get(cookieStoreId).delete(tabId);
}

// Checks whether a container is believed to be empty
function isEmptyContainer(cookieStoreId) {
  const containerTabs = containers.get(cookieStoreId);
  return containerTabs.size === 0;
}

function forgetContainer(cookieStoreId) {
  debug.log('Forgetting container', cookieStoreId);
  containers.delete(cookieStoreId);
}

async function removeContainer(cookieStoreId) {
  debug.log('Removing container', cookieStoreId);
  await browser.contextualIdentities.remove(cookieStoreId);
}

// Forgets a container from the extension state and destroys it
async function forgetAndRemoveContainer(cookieStoreId) {
  forgetContainer(cookieStoreId);
  await removeContainer(cookieStoreId);
  // QUESTION: An "Error: Invalid tab ID" is always logged after this, with
  // the ID of the last tab removed. Is this a problem? Is it avoidable?
}

// Expose state to the integration tests
window.stateForTests = {
  containers,
  tabs,
  rebuildDatabase,
  handleBrowserAction,
  handleMenuItem,
  createContainer,
  handleInstalled,
  handleStartup,
};
