/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

describe('integration tests', function () {

  let background = browser.extension.getBackgroundPage();

  async function containersCreated (work) {
    let before = new Set((await browser.contextualIdentities.query({}))
      .map(cont => cont.cookieStoreId));
    await work();
    let after = await browser.contextualIdentities.query({});
    return after.flatMap(cont => !before.has(cont.cookieStoreId) ? [cont] : []);
  }

  async function containersAndTabsCreated (work) {
    let prevCsIds = new Set((await browser.contextualIdentities.query({}))
      .map(cont => cont.cookieStoreId));
    let prevTabIds = new Set((await browser.tabs.query({}))
      .map(tab => tab.id));
    await work();
    let postCsIds = (await browser.contextualIdentities.query({}))
      .map(cont => cont.cookieStoreId);
    let postTabIds = (await browser.tabs.query({}))
      .map(tab => tab.id);
    let newCsIds = postCsIds.flatMap(csid => !prevCsIds.has(csid) ? [csid]: []);
    let newTabIds = postTabIds.flatMap(id => !prevTabIds.has(id) ? [id]: []);
    return {
      containers: newCsIds,
      tabs: newTabIds
    };
  }

  let tabIds;

  async function saveTabs () {
    let tabs = await browser.tabs.query({});
    return new Set(tabs.map(tab => tab.id));
  }

  async function removeNewTabs (tabIds) {
    let newTabs = await browser.tabs.query({});
    for (let tab of newTabs) {
      if (!tabIds.has(tab.id)) {
        await browser.tabs.remove(tab.id);
      }
    }
  }

  beforeEach(async function () {
    // Record previously open tabs
    tabIds = await saveTabs();
  });

  afterEach(async function () {
    removeNewTabs(tabIds);
  });

  describe('browser action', function () {
    it('should create one container when browser action is clicked', async function () {
      // TODO: is there a way to click the browser action programmatically?
      expect(await browser.browserAction.isEnabled({})).to.be.true;
      // browser is not the same across pages; this check only works if the
      // browser and the listener are on/from the same page
      expect(
        background.browser.browserAction.onClicked.hasListener(
          background.handleBrowserAction
        )
      ).to.be.true;
      let diff = await containersCreated(async () =>
        await background.handleBrowserAction()
      );
      expect(diff).to.have.lengthOf(1);
    });
  });

  describe('link context menu item', function () {
    it('should listen for clicks', async function () {
      // TODO: API provides no way to check if menu item exists, is enabled, or
      // is visible
      expect(background.browser.menus.onClicked.hasListener(
        background.handleMenuItem
      )).to.be.true;
    });
    context('without a provided tabs.Tab', function () {
      it('should open in a new temp container', async function () {
        let diff = await containersCreated(async () => {
          await background.handleMenuItem({
            menuItemId: "new-temp-container-tab", // TODO: assert other ids are ignored
            linkUrl: "about:blank"
            // TODO: test with and without a tab (.index)
          });
        });
        expect(diff).to.have.lengthOf(1);
        let container = diff[0];
        let tabs = await browser.tabs.query({
          cookieStoreId: container.cookieStoreId
        });
        expect(tabs).to.have.lengthOf(1);
        let tab = tabs[0];
        // TODO: can't check if tab has correct url without "tabs" permission
      });
    });
    context('with a provided tabs.Tab', function () {
      it('should open in a new temp container at next index', async function () {
        let leftTab = await browser.tabs.create({});
        let rightTab = await browser.tabs.create({index: leftTab.index + 1});
        let diff = await containersCreated(async () => {
          await background.handleMenuItem({
            menuItemId: "new-temp-container-tab",
            linkUrl: "about:blank"
          }, {
            index: leftTab.index
          });
        });
        expect(diff).to.have.lengthOf(1);
        let tabs = await browser.tabs.query({
          cookieStoreId: diff[0].cookieStoreId
        });
        expect(tabs).to.have.lengthOf(1);
        let tab = tabs[0];
        leftTab = await browser.tabs.get(leftTab.id);
        rightTab = await browser.tabs.get(rightTab.id);
        expect(tab.index).to.equal(leftTab.index + 1);
        expect(tab.index).to.equal(rightTab.index - 1);
      });
    });
    // TODO: no in-browser way to test this
    it('should not appear on privileged urls');
  });

  describe('key command', function () {
    // this is not meaningful if key-command cannot be faked and it only triggers
    // browser action
    it('should create one container when key-command is entered');
  });

  // If the passed promise resolves, the returned promise rejects with the
  // resolved value.  If the passed promise rejects, the returned promise
  // resolves with the rejected value.
  function invertP (promise) {
    return promise.then(value => {throw value;}, error => error);
  }

  describe('temporary containers', function () {
    context('when empty', function () {
      it('should be removed', async function () {
        let container = (await containersCreated(background.handleBrowserAction))[0];
        let tab = (await browser.tabs.query({cookieStoreId: container.cookieStoreId}))[0];
        await browser.tabs.remove(tab.id);
        // TODO: is the onRemoved() handler guaranteed, or even expected, to be
        // called by now?
        // TODO: This is a hack, should eventually bundle chai-as-promised and use
        // .to.be.rejected instead
        await invertP(browser.contextualIdentities.get(container.cookieStoreId));
      });
    });

    context('when renamed', function () {
      it('should no longer be temporary', async function () {
        let csid = (await containersCreated(background.handleBrowserAction))[0].cookieStoreId;
        let tab = (await browser.tabs.query({cookieStoreId: csid}))[0];
        await browser.contextualIdentities.update(csid, {name: "A Container"});
        await browser.tabs.remove(tab.id);
        let container = await browser.contextualIdentities.get(csid);
        expect(container.name).to.equal("A Container");
      });
    });
  });

  describe('rebuildDatabase()', function () {
    it('should record all open temporary containers & their tabs', async function () {
      // Create containers, tabs in a new window
      let windowId = (await browser.windows.create()).id;
      let {containers: tempCsIds, tabs: tempTabIds} = await containersAndTabsCreated(async () => {
        for (let i = 0; i < 4; i++) {
          await background.handleBrowserAction();
        }
      });
      let otherContainers = [];
      otherContainers.push(await browser.contextualIdentities.create({
        name: "A Container",
        color: "toolbar",
        icon: "fingerprint"
      }));
      otherContainers.push(await browser.contextualIdentities.create({
        name: "Another Container",
        color: "green",
        icon: "fingerprint"
      }));
      let otherTabs = [];
      otherTabs.push(await browser.tabs.create({cookieStoreId: otherContainers[0].cookieStoreId}));
      tempTabIds.push((await browser.tabs.create({cookieStoreId: tempCsIds[1]})).id);
      otherTabs.push(await browser.tabs.create({cookieStoreId: otherContainers[1].cookieStoreId}));

      // Run rebuildDatabase()
      await background.rebuildDatabase();

      // TODO: temp
      console.log(background.containers, background.tabs);
      console.log(tempCsIds, tempTabIds, otherContainers, otherTabs);

      // Check database contents
      for (let cookieStoreId of tempCsIds) {
        expect(background.containers).to.include.keys(cookieStoreId);
      }
      for (let container of otherContainers) {
        expect(background.containers).to.not.include.keys(container.cookieStoreId);
      }
      for (let tabId of tempTabIds) {
        expect(background.tabs).to.include.keys(tabId);
        expect(tempCsIds).to.include(background.tabs.get(tabId));
      }
      for (let tab of otherTabs) {
        expect(background.tabs).to.not.include.keys(tab.id);
      }

      // Clean up created non-temp containers
      await Promise.all(otherContainers.map(container => {
        return browser.contextualIdentities.remove(container.cookieStoreId);
      }));

      // Clean up created window
      await browser.windows.remove(windowId);
    });

    it('should remove empty temporary containers', async function () {
      let csids = await Promise.all([0,1,2,3].map(async () => {
        return (await background.createContainer()).cookieStoreId;
      }));
      console.log(csids);
      await browser.tabs.create({cookieStoreId: csids[0]});
      await browser.tabs.create({cookieStoreId: csids[2]});
      await background.rebuildDatabase();
      expect(await browser.contextualIdentities.get(csids[0])).to.exist;
      await invertP(browser.contextualIdentities.get(csids[1]));
      expect(await browser.contextualIdentities.get(csids[2])).to.exist;
      await invertP(browser.contextualIdentities.get(csids[3]));
    });

    // TODO test these from outside the extension, possibly using "management"?
    it('should trigger on install', function () {
      expect(background.browser.runtime.onInstalled.hasListener(
        background.handleInstalled
      )).to.be.true;
      // TODO spy rebuildDatabase to ensure that it is called?
    });
    it('should trigger on update');
    it('should trigger on browser launch', function () {
      expect(background.browser.runtime.onStartup.hasListener(
        background.handleStartup
      )).to.be.true;
      // TODO spy rebuildDatabase to ensure that it is called?
    });
  });
});
