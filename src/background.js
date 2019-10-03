/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Register event handlers
browser.tabs.onRemoved.addListener(handleTabRemoved);
browser.tabs.onCreated.addListener(handleTabCreated);
browser.browserAction.onClicked.addListener(handleBrowserAction);
browser.runtime.onStartup.addListener(handleStartup);
browser.runtime.onInstalled.addListener(handleInstalled);

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

// Core / Consistency:
// TODO: this is approximately th opposite of a consistency model

// Creates, records, and returns a new temporary container
async function createContainer () {
  performance.mark("start createContainer");
  let color = randomChoice(...colors)
  let container = await browser.contextualIdentities.create({
      name: "Temp",
      color: color,
      icon: "chill"
  });
  let cookieStoreId = container.cookieStoreId;
  genName(container)
    .then(name => browser.contextualIdentities.update(cookieStoreId, {
      name: name
    }));
  addContainerToDb(container.cookieStoreId);
  performance.mark("end createContainer");
  performance.measure("measure createContainer", "start createContainer", "end createContainer");
  let entry = performance.getEntriesByName("measure createContainer", "measure")[0];
  console.log("created container", cookieStoreId, "in", entry.duration, "ms");
  return container;
}

// Iterates through all containers and tabs to rebuild extension state
// TODO: inefficient if tabs.query is O(n) in total number of tabs
async function rebuildDatabase () {
  performance.mark("start rebuild");
  // TODO: if this takes awhile, the results could be inconsistent, because
  // browseraction could be used or tabs could be opened or closed
  // Wipe previous data // TODO: can there ever be any?
  containers.clear();
  tabs.clear();
  // check all extant containers
  let allContainers = await browser.contextualIdentities.query({});
  for (let container of allContainers) {
    if (await isManagedContainer(container)) {
      let cookieStoreId = container.cookieStoreId;
      addContainerToDb(cookieStoreId);
      // record every tab in each managed container
      // TODO: will tabs.query weirdness matter here?
      let containerTabs = await browser.tabs.query({cookieStoreId: cookieStoreId});
      // TODO: can this happen in cases other than extension failure?
      if (containerTabs.length == 0) {
        forgetAndRemoveContainer(cookieStoreId);
      }
      for (let tab of containerTabs) {
        addTabToDb(tab);
      }
    }
  }
  performance.mark("end rebuild");
  performance.measure("measure rebuild", "start rebuild", "end rebuild");
  let entry = performance.getEntriesByName("measure rebuild", "measure")[0];
  console.log("Rebuilt database in", entry.duration, "ms");
  console.log("Rebuilt database is", containers, tabs);
}

// State Operations:

// Records a tab in the extension state
// TODO: handle case where tab is not in a known container
function addTabToDb (tab) {
  console.log("Recording tab", tab.id, "in container", tab.cookieStoreId);
  tabs.set(tab.id, tab.cookieStoreId);
  containers.get(tab.cookieStoreId).add(tab.id);
}

// Records a container in the extension state
function addContainerToDb (cookieStoreId) {
  console.log("Recording temporary container: ", cookieStoreId)
  // TODO: this check should always be true
  if (!containers.has(cookieStoreId)) {
    containers.set(cookieStoreId, new Set());
  }
}

// Forgets a tab from the extension state
// TODO: handle case where tab is not in a known container
function forgetTab (tabId, cookieStoreId) {
  console.log("Forgetting tab", tabId, "in container", cookieStoreId);
  tabs.delete(tabId);
  containers.get(cookieStoreId).delete(tabId);
}

// Checks whether a container is believed to be empty
function isEmptyContainer(cookieStoreId) {
  console.log("Checking status of container", cookieStoreId);
  let containerTabs = containers.get(cookieStoreId);
  console.log("Found", containerTabs.size, "remaining tabs:", containerTabs);
  return containerTabs.size == 0;
}

// Forgets a container from the extension state and destroys it
async function forgetAndRemoveContainer (cookieStoreId) {
  containers.delete(cookieStoreId);
  await browser.contextualIdentities.remove(cookieStoreId);
  console.log("Removed & forgot container", cookieStoreId);
  // TODO: An "Error: Invalid tab ID" is always logged after this, with the ID
  // of // the last tab removed. Is this a problem? Is it avoidable?
}

// Container Utilities:

// Generates a name for the given container
// Name incorporates a hash of the container's cookieStoreId and color
async function genName (container) {
  return "Temp " + await truncatedHash(container.cookieStoreId + container.color, 4);
}

// Checks whether a container's name and icon are consistent with containers
// produced by createContainer.  Any such container is considered managed by
// this extension, and will be deleted when empty.
async function isManagedContainer (container) {
  return (container.name.startsWith("Temp") && container.icon == "chill"
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
  let hexBytes = new Array(...bytes).map(i => i.toString(16).padStart(2, '0'));
  return hexBytes.join('');
}

// Returns one of its arguments, chosen at random
function randomChoice (...options) {
  return options[Math.floor(Math.random() * options.length)];
}
