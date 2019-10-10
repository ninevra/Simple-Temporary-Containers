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

browser.menus.create({
  contexts: ["link"],
  id: "new-temp-container-tab",
  title: "Open Link in New Temp &Container Tab"
}, () => {
  if (browser.runtime.lastError) {
    console.error("Error encountered while creating context menu item",
      browser.runtime.lastError);
  }
});

browser.menus.onClicked.addListener(handleMenuItem);

// Globals:

// A Map whose keys are the cookieStoreIds of all containers managed here
// and whose values are Sets of all tabIds open in the container
const containers = new Map();
// A Map from tabIds to cookieStoreIds of all tabs managed by this extension
const tabs = new Map();
// A utf-8 TextEncoder
const utf8Encoder = new TextEncoder();
// An array of all names of allowed container colors
const colors = [
    "blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"
];
// Set true to enable more logging
const debug = true;

// Event handlers:

// Handles browser starting with the extension installed
// TODO: verify this is called correctly
function handleStartup () {
  rebuildDatabase();
}

// Handles extension being installed, reinstalled, or updated
function handleInstalled (details) {
  // TODO if this is an update, does the data still exist?
  rebuildDatabase();
}

// Handles tabs being opened
// If the tab belongs to a recorded container, then records the tab
function handleTabCreated (tab) {
  let cookieStoreId = tab.cookieStoreId;
  if (containers.has(cookieStoreId)) {
    addTabToDb(tab);
  }
}

// Handles tabs being closed
// If the tab was recorded, then forget it
// If the tab's container is now empty, then forget and destroy it
async function handleTabRemoved (tabId, removeInfo) {
  // TODO: handle unexpected cases where container not recorded or doesn't
  // record the tab
  if (tabs.has(tabId)) {
    let cookieStoreId = tabs.get(tabId);
    forgetTab(tabId, cookieStoreId);
    if (isEmptyContainer(cookieStoreId)) {
      await forgetAndRemoveContainer(cookieStoreId);
    }
  }
}

// Handles the browserAction being clicked
// Create a new container and an empty tab in that container
async function handleBrowserAction (activeTab) {
  let container = await createContainer();
  let tab = await browser.tabs.create({
    cookieStoreId: container.cookieStoreId
  });
}

// Handles the menu item being clicked
// Open a new container and a new tab with the given link
async function handleMenuItem (info, tab) {
  // TODO: Handle srcUrls as well? would require registering the 'image' context
  // TODO: Can tab parameter ever be missing in the registered contexts??
  if (info.menuItemId == "new-temp-container-tab") {
    let container = await createContainer();
    let newTab = await browser.tabs.create({
      cookieStoreId: container.cookieStoreId,
      url: info.linkUrl,
      index: tab ? tab.index + 1 : undefined,
      active: false
    });
  }
}

// If a managed container's name has been changed by the user, unmanage it
async function handleIdentityUpdated ({ contextualIdentity: container }) {
  if (debug) console.log("Continer updated", container);
  if (containers.has(container.cookieStoreId)) {
    if (!await isManagedContainer(container)) {
      forgetContainer(container.cookieStoreId);
    }
  }
}

// State Operations:

// Creates, records, and returns a new temporary container
async function createContainer () {
  if (debug) console.time("createContainer");
  let color = randomChoice(...colors)
  let container = await browser.contextualIdentities.create({
      name: "Temp",
      color: color,
      icon: "circle"
  });
  let cookieStoreId = container.cookieStoreId;
  let name = await genName(container);
  await browser.contextualIdentities.update(cookieStoreId, {name: name});
  addContainerToDb(container.cookieStoreId);
  if (debug) console.timeEnd("createContainer")
  if (debug) console.log("created container", cookieStoreId);
  return container;
}

// Iterates through all containers and tabs to rebuild extension state
async function rebuildDatabase () {
  console.time("rebuildDatabase");
  // TODO: if this takes awhile, the results could be inconsistent, because
  // browseraction could be used or tabs could be opened or closed
  // Wipe previous data // TODO: can there ever be any?
  containers.clear();
  tabs.clear();
  // check all extant containers
  let [allContainers, allTabs] = await Promise.all([
    browser.contextualIdentities.query({}),
    browser.tabs.query({})
  ]);
  await Promise.all(allContainers.map(async (container) => {
    if (await isManagedContainer(container)) {
      let cookieStoreId = container.cookieStoreId;
      addContainerToDb(cookieStoreId);
    }
  }));
  for (let tab of allTabs) {
    if (containers.has(tab.cookieStoreId)) {
      addTabToDb(tab);
    }
  }
  await Promise.all([...containers.keys()].map(async (cookieStoreId) => {
    if (isEmptyContainer(cookieStoreId)) {
      await forgetAndRemoveContainer(cookieStoreId);
    }
  }));
  console.timeEnd("rebuildDatabase");
  if (debug) console.log("Rebuilt database is", containers, tabs);
}

// Records a tab in the extension state
// TODO: handle case where tab is not in a known container
function addTabToDb (tab) {
  if (debug) console.log("Recording tab", tab.id, "in container",
    tab.cookieStoreId);
  tabs.set(tab.id, tab.cookieStoreId);
  containers.get(tab.cookieStoreId).add(tab.id);
}

// Records a container in the extension state
function addContainerToDb (cookieStoreId) {
  if (debug) console.log("Recording temporary container: ", cookieStoreId)
  // TODO: this check should always be true
  if (!containers.has(cookieStoreId)) {
    containers.set(cookieStoreId, new Set());
  }
}

// Forgets a tab from the extension state
// TODO: handle case where tab is not in a known container
function forgetTab (tabId, cookieStoreId) {
  if (debug) console.log("Forgetting tab", tabId, "in container",
    cookieStoreId);
  tabs.delete(tabId);
  containers.get(cookieStoreId).delete(tabId);
}

// Checks whether a container is believed to be empty
function isEmptyContainer(cookieStoreId) {
  let containerTabs = containers.get(cookieStoreId);
  return containerTabs.size == 0;
}

function forgetContainer (cookieStoreId) {
  console.log("Forgetting container", cookieStoreId);
  containers.delete(cookieStoreId);
}

async function removeContainer (cookieStoreId) {
  console.log("Removing container", cookieStoreId);
  await browser.contextualIdentities.remove(cookieStoreId);
}

// Forgets a container from the extension state and destroys it
async function forgetAndRemoveContainer (cookieStoreId) {
  forgetContainer(cookieStoreId);
  await removeContainer(cookieStoreId);
  // TODO: An "Error: Invalid tab ID" is always logged after this, with the ID
  // of the last tab removed. Is this a problem? Is it avoidable?
}

// Container Utilities:

// Generates a name for the given container
// Name incorporates a hash of the container's cookieStoreId and color
async function genName (container) {
  // TODO: do we benefit by including color here? removing color and icon from
  // checks would allow user to change them w/o "unmanaging" the container;
  // cookieStoreId is already unique and persistent
  return "Temp " + await truncatedHash(container.cookieStoreId, 4);
}

// Checks whether a container's name and icon are consistent with containers
// produced by createContainer.  Any such container is considered managed by
// this extension, and will be deleted when empty.
async function isManagedContainer (container) {
  return (container.name.startsWith("Temp") && container.icon == "circle"
    && container.name == await genName(container));
}

// Other Utiilities:

// Computes a hexadecimal string hash of the given string
// Takes the first bytes of the sha1 digest
async function truncatedHash(string, length) {
  // TODO: Does endianness matter here? Can or should DataView be used instead
  // of Uint8Array?
  let buffer = utf8Encoder.encode(string);
  let hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
  let bytes = new Uint8Array(hashBuffer).slice(0, length);
  let hexBytes = [...bytes].map(i => i.toString(16).padStart(2, '0'));
  return hexBytes.join('');
}

// Returns one of its arguments, chosen at random
function randomChoice (...options) {
  return options[Math.floor(Math.random() * options.length)];
}
