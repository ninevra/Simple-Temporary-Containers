describe('integration tests', function () {

  let background = browser.extension.getBackgroundPage();

  async function containersCreated (work) {
    let before = new Set((await browser.contextualIdentities.query({}))
      .map(cont => cont.cookieStoreId));
    await work();
    let after = await browser.contextualIdentities.query({});
    return after.flatMap(cont => !before.has(cont.cookieStoreId) ? [cont] : []);
  }

  let tabIds;

  beforeEach(async function () {
    // Record previously open tabs
    let tabs = await browser.tabs.query({});
    tabIds = new Set(tabs.map(tab => tab.id));
  });

  afterEach(async function () {
    let newTabs = await browser.tabs.query({});
    for (let tab of newTabs) {
      if (!tabIds.has(tab.id)) {
        await browser.tabs.remove(tab.id);
      }
    }
  })

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

});
