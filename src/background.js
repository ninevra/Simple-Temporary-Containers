/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Setup & Register Event Handlers:

browser.tabs.onRemoved.addListener(handleTabRemoved);
browser.tabs.onCreated.addListener(handleTabCreated);
browser.browserAction.onClicked.addListener(handleBrowserAction);
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

// Globals:

// A Map whose keys are the cookieStoreIds of all containers managed here
// and whose values are Sets of all tabIds open in the container
var containers = new Map();
// A Map from tabIds to cookieStoreIds of all tabs managed by this extension
var tabs = new Map();
// A utf-8 TextEncoder
const utf8Encoder = new TextEncoder();
// An array of all names of allowed container colors
var colors = [
  'blue',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
];
// Set true to enable more logging
var debug = false;

// Event handlers:

// Handles browser starting with the extension installed
// TODO: verify this is called correctly
function handleStartup() {
  rebuildDatabase();
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
function handleTabCreated(tab) {
  const cookieStoreId = tab.cookieStoreId;
  if (containers.has(cookieStoreId)) {
    addTabToDb(tab);
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
  // Tab will be created at end of window. banned colors: last tab in window, current active tab
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
  if (debug) console.log('Continer updated', container);
  if (
    containers.has(container.cookieStoreId) &&
    !(await isManagedContainer(container))
  ) {
    forgetContainer(container.cookieStoreId);
  }
}

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
  if (debug) console.log('created container', cookieStoreId);
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
      if (await isManagedContainer(container)) {
        const cookieStoreId = container.cookieStoreId;
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
  if (debug) console.log('Rebuilt database is', containers, tabs);
}

// Records a tab in the extension state
// TODO: handle case where tab is not in a known container
function addTabToDb(tab) {
  if (debug)
    console.log('Recording tab', tab.id, 'in container', tab.cookieStoreId);
  tabs.set(tab.id, tab.cookieStoreId);
  containers.get(tab.cookieStoreId).add(tab.id);
}

// Records a container in the extension state
function addContainerToDb(cookieStoreId) {
  if (debug) console.log('Recording temporary container:', cookieStoreId);
  // TODO: this check should always be true
  if (!containers.has(cookieStoreId)) {
    containers.set(cookieStoreId, new Set());
  }
}

// Forgets a tab from the extension state
// TODO: handle case where tab is not in a known container
function forgetTab(tabId, cookieStoreId) {
  if (debug)
    console.log('Forgetting tab', tabId, 'in container', cookieStoreId);
  tabs.delete(tabId);
  containers.get(cookieStoreId).delete(tabId);
}

// Checks whether a container is believed to be empty
function isEmptyContainer(cookieStoreId) {
  const containerTabs = containers.get(cookieStoreId);
  return containerTabs.size === 0;
}

function forgetContainer(cookieStoreId) {
  if (debug) console.log('Forgetting container', cookieStoreId);
  containers.delete(cookieStoreId);
}

async function removeContainer(cookieStoreId) {
  if (debug) console.log('Removing container', cookieStoreId);
  await browser.contextualIdentities.remove(cookieStoreId);
}

// Forgets a container from the extension state and destroys it
async function forgetAndRemoveContainer(cookieStoreId) {
  forgetContainer(cookieStoreId);
  await removeContainer(cookieStoreId);
  // QUESTION: An "Error: Invalid tab ID" is always logged after this, with the
  // ID of the last tab removed. Is this a problem? Is it avoidable?
}

// Container Utilities:

// Generates a name for the given container
// Name incorporates a random byte and a hash of that byte and the container's
// cookieStoreId
async function genName(container) {
  // A random byte
  const seedByte = crypto.getRandomValues(new Uint8Array(1));
  // A hexadecimal string encoding the random byte
  const seedString = toHexString(seedByte);
  // A hash value
  const hash = await hashConcat(seedString, container.cookieStoreId);
  return 'Temp ' + seedString + hash.slice(0, 6);
}

var managedContainerChecks = new Map();
managedContainerChecks.set('0.1.0', async (container) => {
  const match = container.name.match(/^Temp ([a-f\d]{8})$/);
  return (
    match && match[1] === (await sha1(container.cookieStoreId)).slice(0, 8)
  );
});
managedContainerChecks.set('0.2.0', async (container) => {
  const match = container.name.match(/^Temp ([a-f\d]{2})([a-f\d]{6}$)/);
  if (match) {
    const [, seed, hash] = match;
    const expectation = (await hashConcat(seed, container.cookieStoreId)).slice(
      0,
      6
    );
    if (hash === expectation) {
      return true;
    }
  }

  return false;
});

// Checks whether a container's name is consistent with containers produced by
// createContainer. Any such container is considered managed by this extension,
// and will be deleted when empty.
async function isManagedContainer(container) {
  if (container.name.startsWith('Temp ')) {
    // TODO could use Promise.any or p-locate to speed this up a bit, at the
    // cost of a bit of clarity
    const checks = await Promise.all(
      [...managedContainerChecks.values()].map((check) => check(container))
    );
    return checks.some((passed) => passed);
  }

  return false;
}

// QUESTION: Does endianness matter here? Can or should DataView be used
// instead of Uint8Array?

// Computes a hexadecimal string hash of the given string
// Takes the first bytes of the sha1 digest
// eslint-disable-next-line no-unused-vars
async function truncatedHash(string, length) {
  // QUESTION: Does endianness matter here? Can or should DataView be used
  // instead of Uint8Array?
  const buffer = utf8Encoder.encode(string);
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
  const bytes = new Uint8Array(hashBuffer).slice(0, length);
  const hexBytes = [...bytes].map((i) => i.toString(16).padStart(2, '0'));
  return hexBytes.join('');
}
// Other Utilities:

async function hash(string, hashType) {
  const buffer = utf8Encoder.encode(string);
  const hashBuffer = await crypto.subtle.digest(hashType, buffer);
  const bytes = new Uint8Array(hashBuffer);
  return toHexString(bytes);
}

async function sha1(string) {
  return hash(string, 'SHA-1');
}

// Returns a hexadecimal string encoding the provided Uint8Array
function toHexString(byteArray) {
  return [...byteArray].map((i) => i.toString(16).padStart(2, '0')).join('');
}

// Returns a hash of the input strings, constructed by hashing the concatenation
// of them and their lengths
async function hashConcat(...strings) {
  const data = strings.map((s) => `${s.length.toString(16)}.${s}`).join('');
  return sha1(data);
}

// Returns an ArrayBuffer containing the concatenation of the data in the
// provided ArrayBuffers.
function concatBuffers(...buffers) {
  const arrays = buffers.map((b) => Array.from(new Uint8Array(b)));
  const concatArray = [].concat(...arrays);
  return Uint8Array.from(concatArray).buffer;
}

// Returns a hash of the input strings, constructed by hashing the concatenation
// of their hashes
// eslint-disable-next-line no-unused-vars
async function hashList(...strings) {
  const buffers = strings.map((s) => utf8Encoder.encode(s));
  const hashListBuffers = await Promise.all(
    buffers.map((b) => crypto.subtle.digest('SHA-1', b))
  );
  const hashListBuffer = concatBuffers(...hashListBuffers);
  const topHashBuffer = await crypto.subtle.digest('SHA-1', hashListBuffer);
  return toHexString(new Uint8Array(topHashBuffer));
}

// Returns a container color, chosen at random, excluding the arguments
function randomColor(...denyList) {
  denyList = new Set(denyList);
  return randomChoice(...colors.filter((color) => !denyList.has(color)));
}

// Returns one of its arguments, chosen at random
function randomChoice(...options) {
  return options[Math.floor(Math.random() * options.length)];
}

// Returns the color name of the given tab's container, or undefined if there is
// none (e.g., the container is firefox-default)
async function tabColor(tab) {
  const csid = tab.cookieStoreId;
  try {
    const container = await browser.contextualIdentities.get(csid);
    return container.color;
  } catch {
    return undefined;
  }
}

// Returns an array containing the container color names of every given tab that
// has one
async function tabColors(...tabs) {
  return (await Promise.all(tabs.map((tab) => tabColor(tab)))).filter((c) => c);
}

// Returns the tabs.Tab of the rightmost tab in the given window
// TODO: can a window have 0 tabs?
async function rightmostTab(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  return tabs[tabs.length - 1];
}

// Returns the tab following the given one, or undefined if there is none
async function nextTab(tab) {
  const tabs = await browser.tabs.query({
    windowId: tab.windowId,
    index: tab.index + 1,
  });
  if (tabs.length > 0) {
    return tabs[0];
  }

  return undefined;
}
