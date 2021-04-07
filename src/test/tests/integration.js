/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export {}; // Ensure this is run as an ecmascript module

describe('integration tests', () => {
  const background = browser.extension.getBackgroundPage();
  const app = background.app;

  async function containersCreated(work) {
    const before = new Set(
      (await browser.contextualIdentities.query({})).map(
        (cont) => cont.cookieStoreId
      )
    );
    await work();
    const after = await browser.contextualIdentities.query({});
    return after.filter((cont) => !before.has(cont.cookieStoreId));
  }

  async function containersAndTabsCreated(work) {
    const previousCsIds = new Set(
      (await browser.contextualIdentities.query({})).map(
        (cont) => cont.cookieStoreId
      )
    );
    const previousTabIds = new Set(
      (await browser.tabs.query({})).map((tab) => tab.id)
    );
    await work();
    const postCsIds = (await browser.contextualIdentities.query({})).map(
      (cont) => cont.cookieStoreId
    );
    const postTabIds = (await browser.tabs.query({})).map((tab) => tab.id);
    const newCsIds = postCsIds.filter((csid) => !previousCsIds.has(csid));
    const newTabIds = postTabIds.filter((id) => !previousTabIds.has(id));
    return {
      containers: newCsIds,
      tabs: newTabIds,
    };
  }

  beforeEach(() => {
    // Records tabs created by the test
    sinon.spy(browser.tabs, 'create');
    // Records tabs created by the extension
    sinon.spy(background.browser.tabs, 'create');
    // Records containers created by the test
    sinon.spy(browser.contextualIdentities, 'create');
    // Records containers created by the extension
    sinon.spy(background.browser.contextualIdentities, 'create');
  });

  afterEach(async () => {
    // Remove tabs created by test
    const testTabs = await Promise.all(browser.tabs.create.returnValues);
    await Promise.all(
      testTabs.map((tab) => browser.tabs.remove(tab.id).catch(() => {}))
    );
    // Remove tabs created by extension
    const extTabs = await Promise.all(
      background.browser.tabs.create.returnValues
    );
    await Promise.all(
      extTabs.map((tab) => browser.tabs.remove(tab.id).catch(() => {}))
    );
    // Remove containers created by test
    const testContainers = await Promise.all(
      browser.contextualIdentities.create.returnValues
    );
    await Promise.all(
      testContainers.map((container) =>
        browser.contextualIdentities
          .remove(container.cookieStoreId)
          .catch(() => {})
      )
    );
    // Remove container create by extension
    const extContainers = await Promise.all(
      background.browser.contextualIdentities.create.returnValues
    );
    await Promise.all(
      extContainers.map((container) =>
        browser.contextualIdentities
          .remove(container.cookieStoreId)
          .catch(() => {})
      )
    );
    // Restore spies
    browser.tabs.create.restore();
    background.browser.tabs.create.restore();
    browser.contextualIdentities.create.restore();
    background.browser.contextualIdentities.create.restore();
  });

  describe('browser action', () => {
    it('should create one container when browser action is clicked', async () => {
      // TODO: is there a way to click the browser action programmatically?
      expect(await browser.browserAction.isEnabled({})).to.be.true;
      // Browser is not the same across pages; this check only works if the
      // browser and the listener are on/from the same page
      expect(
        background.browser.browserAction.onClicked.hasListener(
          app.handleBrowserAction
        )
      ).to.be.true;
      const diff = await containersCreated(async () =>
        app.handleBrowserAction(await browser.tabs.getCurrent())
      );
      expect(diff).to.have.lengthOf(1);
    });
  });

  describe('link context menu item', () => {
    it('should listen for clicks', async () => {
      // TODO: API provides no way to check if menu item exists, is enabled, or
      // is visible
      expect(background.browser.menus.onClicked.hasListener(app.handleMenuItem))
        .to.be.true;
    });
    context('without a provided tabs.Tab', () => {
      it('should open in a new temp container', async () => {
        const diff = await containersCreated(async () => {
          await app.handleMenuItem({
            menuItemId: 'new-temp-container-tab', // TODO: assert other ids are ignored
            linkUrl: 'about:blank',
            // TODO: test with and without a tab (.index)
          });
        });
        expect(diff).to.have.lengthOf(1);
        const container = diff[0];
        const tabs = await browser.tabs.query({
          cookieStoreId: container.cookieStoreId,
        });
        expect(tabs).to.have.lengthOf(1);
        // TODO: can't check if tab has correct url without "tabs" permission
      });
    });
    context('with a provided tabs.Tab', () => {
      it('should open in a new temp container at next index', async () => {
        let leftTab = await browser.tabs.create({});
        let rightTab = await browser.tabs.create({ index: leftTab.index + 1 });
        const diff = await containersCreated(async () => {
          await app.handleMenuItem(
            {
              menuItemId: 'new-temp-container-tab',
              linkUrl: 'about:blank',
            },
            {
              index: leftTab.index,
            }
          );
        });
        expect(diff).to.have.lengthOf(1);
        const tabs = await browser.tabs.query({
          cookieStoreId: diff[0].cookieStoreId,
        });
        expect(tabs).to.have.lengthOf(1);
        const tab = tabs[0];
        leftTab = await browser.tabs.get(leftTab.id);
        rightTab = await browser.tabs.get(rightTab.id);
        expect(tab.index).to.equal(leftTab.index + 1);
        expect(tab.index).to.equal(rightTab.index - 1);
      });
    });
    // TODO: no in-browser way to test this
    it('should not appear on privileged urls');
  });

  describe('key command', () => {
    // This is not meaningful if key-command cannot be faked and it only triggers
    // browser action
    it('should create one container when key-command is entered');
  });

  // If the passed promise resolves, the returned promise rejects with the
  // resolved value.  If the passed promise rejects, the returned promise
  // resolves with the rejected value.
  function invertP(promise) {
    return promise.then(
      (value) => {
        throw value;
      },
      (error) => error
    );
  }

  describe('temporary containers', () => {
    context('when empty', () => {
      it('should be removed', async () => {
        const container = (
          await containersCreated(async () =>
            app.handleBrowserAction(await browser.tabs.getCurrent())
          )
        )[0];
        const tab = (
          await browser.tabs.query({ cookieStoreId: container.cookieStoreId })
        )[0];
        await browser.tabs.remove(tab.id);
        // TODO: is the onRemoved() handler guaranteed, or even expected, to be
        // called by now?
        // TODO: This is a hack, should eventually bundle chai-as-promised and use
        // .to.be.rejected instead
        await invertP(
          browser.contextualIdentities.get(container.cookieStoreId)
        );
      });
    });

    context('when renamed', () => {
      it('should no longer be temporary', async () => {
        const csid = (
          await containersCreated(async () =>
            app.handleBrowserAction(await browser.tabs.getCurrent())
          )
        )[0].cookieStoreId;
        const tab = (await browser.tabs.query({ cookieStoreId: csid }))[0];
        await browser.contextualIdentities.update(csid, {
          name: 'A Container',
        });
        await browser.tabs.remove(tab.id);
        const container = await browser.contextualIdentities.get(csid);
        expect(container.name).to.equal('A Container');
      });
    });
  });

  describe('rebuildDatabase()', () => {
    it('should record all open temporary containers & their tabs', async () => {
      // Create containers, tabs in a new window
      const windowId = (await browser.windows.create()).id;
      const {
        containers: temporaryCsIds,
        tabs: temporaryTabIds,
      } = await containersAndTabsCreated(async () => {
        for (let i = 0; i < 4; i++) {
          await app.handleBrowserAction(await browser.tabs.getCurrent());
        }
      });
      const otherContainers = [];
      otherContainers.push(
        await browser.contextualIdentities.create({
          name: 'A Container',
          color: 'toolbar',
          icon: 'fingerprint',
        }),
        await browser.contextualIdentities.create({
          name: 'Another Container',
          color: 'green',
          icon: 'fingerprint',
        })
      );
      const otherTabs = [];
      otherTabs.push(
        await browser.tabs.create({
          cookieStoreId: otherContainers[0].cookieStoreId,
        })
      );
      temporaryTabIds.push(
        (await browser.tabs.create({ cookieStoreId: temporaryCsIds[1] })).id
      );
      otherTabs.push(
        await browser.tabs.create({
          cookieStoreId: otherContainers[1].cookieStoreId,
        })
      );

      // Run rebuildDatabase()
      await app.rebuildDatabase();

      // Check database contents
      for (const cookieStoreId of temporaryCsIds) {
        expect(app.containers).to.include.keys(cookieStoreId);
      }

      for (const container of otherContainers) {
        expect(app.containers).to.not.include.keys(container.cookieStoreId);
      }

      for (const tabId of temporaryTabIds) {
        expect(app.tabs).to.include.keys(tabId);
        expect(temporaryCsIds).to.include(app.tabs.get(tabId));
      }

      for (const tab of otherTabs) {
        expect(app.tabs).to.not.include.keys(tab.id);
      }

      // Clean up created window
      await browser.windows.remove(windowId);
    });

    it('should remove empty temporary containers', async () => {
      const csids = await Promise.all(
        [0, 1, 2, 3].map(async () => {
          return (await app.createContainer()).cookieStoreId;
        })
      );
      await browser.tabs.create({ cookieStoreId: csids[0] });
      await browser.tabs.create({ cookieStoreId: csids[2] });
      await app.rebuildDatabase();
      expect(await browser.contextualIdentities.get(csids[0])).to.exist;
      await invertP(browser.contextualIdentities.get(csids[1]));
      expect(await browser.contextualIdentities.get(csids[2])).to.exist;
      await invertP(browser.contextualIdentities.get(csids[3]));
    });

    // TODO test these from outside the extension, possibly using "management"?
    it('should trigger on install', () => {
      expect(
        background.browser.runtime.onInstalled.hasListener(app.handleInstalled)
      ).to.be.true;
      // TODO spy rebuildDatabase to ensure that it is called?
    });
    it('should trigger on update');
    it('should trigger on browser launch', () => {
      expect(
        background.browser.runtime.onStartup.hasListener(app.handleStartup)
      ).to.be.true;
      // TODO spy rebuildDatabase to ensure that it is called?
    });
  });

  describe('container colors', () => {
    async function repeat(n, fn) {
      while (n > 0) {
        n--;
        await fn(); // eslint-disable-line no-await-in-loop
      }
    }

    describe('browser action', () => {
      it('should use a different color than the current and last tabs', async () => {
        const { cookieStoreId } = await browser.contextualIdentities.create({
          name: 'blue',
          color: 'blue',
          icon: 'fence',
        });
        const tab = await browser.tabs.create({ cookieStoreId });

        let last = 'blue';

        await repeat(20, async () => {
          const {
            containers: [csid],
          } = await containersAndTabsCreated(async () =>
            app.handleBrowserAction(tab)
          );
          const { color } = await browser.contextualIdentities.get(csid);
          expect(color).not.to.equal('blue');
          expect(color).not.to.equal(last);
          last = color;
        });
      });
    });

    describe('link context menu item', () => {
      it('should use a different color than the current and next tabs', async () => {
        const containers = await Promise.all(
          ['yellow', 'orange', 'red'].map((color) =>
            browser.contextualIdentities.create({
              name: color,
              color,
              icon: 'fence',
            })
          )
        );
        const tabs = [];
        for (const { cookieStoreId } of containers) {
          tabs.push(await browser.tabs.create({ cookieStoreId })); // eslint-disable-line no-await-in-loop
        }

        let next = 'red';

        await repeat(20, async () => {
          const {
            containers: [csid],
          } = await containersAndTabsCreated(async () =>
            app.handleMenuItem(
              { menuItemId: 'new-temp-container-tab', linkUrl: 'about:blank' },
              tabs[1]
            )
          );
          const { color } = await browser.contextualIdentities.get(csid);
          expect(color).not.to.equal('orange');
          expect(color).not.to.equal(next);
          next = color;
        });
      });
    });

    describe('tab context menu item', () => {
      it('should use a different color than the current and next tabs', async () => {
        const containers = await Promise.all(
          ['yellow', 'orange', 'red'].map((color) =>
            browser.contextualIdentities.create({
              name: color,
              color,
              icon: 'fence',
            })
          )
        );
        const tabs = [];
        for (const { cookieStoreId } of containers) {
          tabs.push(await browser.tabs.create({ cookieStoreId })); // eslint-disable-line no-await-in-loop
        }

        let next = 'red';

        await repeat(20, async () => {
          const {
            containers: [csid],
          } = await containersAndTabsCreated(async () =>
            app.handleMenuItem(
              {
                menuItemId: 'reopen-in-new-temp-container',
                pageUrl: 'about:blank',
              },
              tabs[1]
            )
          );
          const { color } = await browser.contextualIdentities.get(csid);
          expect(color).not.to.equal('orange');
          expect(color).not.to.equal(next);
          next = color;
        });
      });
    });
  });
});
