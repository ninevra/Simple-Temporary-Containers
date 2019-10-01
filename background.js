browser.tabs.onRemoved.addListener(cleanupTab);
browser.tabs.onCreated.addListener(addTabToDb);
browser.browserAction.onClicked.addListener(newtab);

// A Map whose keys are the cookieStoreIds of all containers managed here
// and whose values are Sets of all tabIds open in the container
let containers = new Map();
// A Map from tabIds to cookieStoreIds of all tabs managed by this extension
let tabs = new Map();

function addTabToDb (tab) {
  console.log("tab created: ", tab);
  let cookieStoreId = tab.cookieStoreId;
  if (containers.has(cookieStoreId)) {
    tabs.set(tab.id, cookieStoreId);
    containers.get(cookieStoreId).add(tab.id);
  }
}

function addContainerToDb (cookieStoreId) {
  console.log("container created: ", cookieStoreId)
  // TODO: this check should always be true
  if (!containers.has(cookieStoreId)) {
    containers.set(cookieStoreId, new Set());
  }
}

function cleanupTab (tabId, removeInfo) {
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
