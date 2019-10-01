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

function handleStartup () {
  rebuildDatabase();
}

function handleInstalled (details) {
  // TODO if this is an update, does the data still exist?
  rebuildDatabase();
}

function isManagedContainer (container) {
  // TODO: can this match be improved?
  return container.color == "orange" && container.name == "Temp" && container.icon == "chill";
}

async function rebuildDatabase () {
  // TODO: log the time this takes
  // TODO: if this takes awhile, the results could be inconsistent, because
  // browseraction could be used or tabs could be opened or closed
  // Wipe previous data // TODO: can there ever be any?
  containers.clear();
  tabs.clear();
  // check all extant containers
  let allContainers = await browser.contextualIdentities.query({});
  for (container of allContainers) {
    if (isManagedContainer(container)) {
      let cookieStoreId = container.cookieStoreId;
      addContainerToDb(cookieStoreId);
      // record every tab in each managed container
      // TODO: will tabs.query weirdness matter here?
      let containerTabs = await browser.tabs.query({cookieStoreId: cookieStoreId});
      for (tab of containerTabs) {
        addTabToDb(tab);
      }
    }
  }
}

function addTabToDb (tab) {
  tabs.set(tab.id, tab.cookieStoreId);
  containers.get(tab.cookieStoreId).add(tab.id);
}

function handleTabCreated (tab) {
  console.log("tab created: ", tab);
  let cookieStoreId = tab.cookieStoreId;
  if (containers.has(cookieStoreId)) {
    addTabToDb(tab);
  }
}

function addContainerToDb (cookieStoreId) {
  console.log("container created: ", cookieStoreId)
  // TODO: this check should always be true
  if (!containers.has(cookieStoreId)) {
    containers.set(cookieStoreId, new Set());
  }
}

function handleTabRemoved (tabId, removeInfo) {
  console.log("tab destroyed: ", tabId)
  if (tabs.has(tabId)) {
    let cookieStoreId = tabs.get(tabId);
    tabs.delete(tabId);
    cleanupContainer(cookieStoreId, tabId);
  }
}

async function cleanupContainer (cookieStoreId, tabId) {
  console.log("cleaning up container: ", cookieStoreId, " from ", containers, tabs);
  // checking only our internal tab database because tabs.query tends to return
  // removed tabs for some reason

  // TODO: handle unexpected cases where container not recorded or doesn't
  // record the tab
  let containerTabs = containers.get(cookieStoreId);
  containerTabs.delete(tabId);
  console.log("found tabs: ", containerTabs)
  if (containerTabs.size == 0) {
    containers.delete(cookieStoreId);
    await browser.contextualIdentities.remove(cookieStoreId);
  }
}

async function newtab (event) {
  console.log("Clicked!");
  let container = await browser.contextualIdentities.create({
      name: "Temp",
      color: "orange",
      icon: "chill"
  });
  addContainerToDb(container.cookieStoreId);
  let tab = browser.tabs.create({
    cookieStoreId: container.cookieStoreId
  });
}
