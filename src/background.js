browser.tabs.onRemoved.addListener(handleTabRemoved);
browser.tabs.onCreated.addListener(handleTabCreated);
browser.browserAction.onClicked.addListener(newtab);
browser.runtime.onStartup.addListener(handleStartup);
browser.runtime.onInstalled.addListener(handleInstalled);

// A Map whose keys are the cookieStoreIds of all containers managed here
// and whose values are Sets of all tabIds open in the container
let containers = new Map();
// A Map from tabIds to cookieStoreIds of all tabs managed by this extension
let tabs = new Map();

// A utf-8 TextEncoder
let utf8Encoder = new TextEncoder();

function handleStartup () {
  rebuildDatabase();
}

function handleInstalled (details) {
  // TODO if this is an update, does the data still exist?
  rebuildDatabase();
}

async function truncatedHash(string) {
  // TODO: Does endianness matter here? Can or should DataView be used instead
  // of Uint8Array?

  // TODO: possibly observed a 3-byte output.  Is this replicable?
  let buffer = utf8Encoder.encode(string);
  let hashBuffer = await crypto.subtle.digest('SHA-1', buffer);

  let bytes = new Uint8Array(hashBuffer).slice(0, 4);
  let hexBytes = new Array(...bytes).map(i => i.toString(16).padStart(2, '0'));
  return hexBytes.join('');
}

let colors = [
    "blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"
];

function randomChoice (...options) {
  return options[Math.floor(Math.random() * options.length)];
}

async function createContainer () {
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
  return container;
}

async function genName (container) {
  return "Temp " + await truncatedHash(container.cookieStoreId + container.color);
}

async function isManagedContainer (container) {
  return (container.name.startsWith("Temp") && container.icon == "chill"
    && container.name == await genName(container));
}

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

function addTabToDb (tab) {
  console.log("Recording tab", tab.id, "in container", tab.cookieStoreId);
  tabs.set(tab.id, tab.cookieStoreId);
  containers.get(tab.cookieStoreId).add(tab.id);
}

function handleTabCreated (tab) {
  let cookieStoreId = tab.cookieStoreId;
  if (containers.has(cookieStoreId)) {
    addTabToDb(tab);
  }
}

function addContainerToDb (cookieStoreId) {
  console.log("Recording temporary container: ", cookieStoreId)
  // TODO: this check should always be true
  if (!containers.has(cookieStoreId)) {
    containers.set(cookieStoreId, new Set());
  }
}

function forgetTab (tabId, cookieStoreId) {
  console.log("Forgetting tab", tabId, "in container", cookieStoreId);
  tabs.delete(tabId);
  containers.get(cookieStoreId).delete(tabId);
}

function isEmptyContainer(cookieStoreId) {
  console.log("Checking status of container", cookieStoreId);
  let containerTabs = containers.get(cookieStoreId);
  console.log("Found", containerTabs.size, "remaining tabs:", containerTabs);
  return containerTabs.size == 0;
}

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

async function forgetAndRemoveContainer (cookieStoreId) {
  containers.delete(cookieStoreId);
  await browser.contextualIdentities.remove(cookieStoreId);
  console.log("Removed & forgot container", cookieStoreId);
  // TODO: An "Error: Invalid tab ID" is always logged after this, with the ID
  // of // the last tab removed. Is this a problem? Is it avoidable?
}

async function newtab (event) {
  let container = await createContainer();
  addContainerToDb(container.cookieStoreId);
  let tab = await browser.tabs.create({
    cookieStoreId: container.cookieStoreId
  });
  console.log("Created new container", container.cookieStoreId, "and tab", tab.id);
}
