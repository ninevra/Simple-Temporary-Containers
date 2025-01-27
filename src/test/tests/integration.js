/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { CONTAINER_MARK } from '../../container-util.js';
import { expect } from '/test/lib/chai/chai.js';
import sinon from '/test/lib/sinon/sinon-esm.js';

// If the given promise resolves, the returned promise rejects. If the passed
// promise rejects, the returned promise resolves with the rejected value.
async function expectToReject(promise) {
  let value;
  try {
    value = await promise;
    throw new Error('Expected promise to reject, but it resolved.', {
      cause: value,
    });
  } catch {
    return value;
  }
}

// Returns an AsyncIterable of the events on the given event source.
// Registers to listen immediately, so no events are lost.
// Unregisters when the AsyncIterable is terminated (e.g. by exiting
// a `for await...of` loop or calling `.return()`)
function events({ addListener, removeListener }) {
  let promise;
  let resolve;
  let buffer = [];
  function listener(event) {
    if (promise) {
      resolve(event);
      promise = undefined;
    } else {
      buffer.push(event);
    }
  }

  addListener(listener);
  async function* eventIterator() {
    try {
      while (true) {
        yield* buffer;
        buffer = [];
        /* eslint-disable-next-line no-use-extend-native/no-use-extend-native --
         * Promise.withResolvers() exists in the browser but not in Node.js
         */
        ({ promise, resolve } = Promise.withResolvers());
        yield promise;
      }
    } finally {
      removeListener(listener);
    }
  }

  return eventIterator();
}

// Traverses the async iterable until the first item matching the predicate,
// terminates the async iterable, and returns that item.
async function until(asyncIterable, predicate) {
  for await (const item of asyncIterable) {
    if (predicate) {
      return item;
    }
  }
}

describe('integration tests', () => {
  const background = browser.extension.getBackgroundPage();
  const app = background.stateForTests;

  async function containersCreated(work) {
    const identities = await browser.contextualIdentities.query({});
    const before = new Set(identities.map((cont) => cont.cookieStoreId));
    await work();
    const after = await browser.contextualIdentities.query({});
    return after.filter((cont) => !before.has(cont.cookieStoreId));
  }

  async function containersAndTabsCreated(work) {
    const previousContainers = await browser.contextualIdentities.query({});
    const previousCsIds = new Set(
      previousContainers.map((cont) => cont.cookieStoreId)
    );
    const previousTabs = await browser.tabs.query({});
    const previousTabIds = new Set(previousTabs.map((tab) => tab.id));
    await work();
    const postContainers = await browser.contextualIdentities.query({});
    const postCsIds = postContainers.map((cont) => cont.cookieStoreId);
    const postTabs = await browser.tabs.query({});
    const postTabIds = postTabs.map((tab) => tab.id);
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
          });
        });
        expect(diff).to.have.lengthOf(1);
        const [{ cookieStoreId }] = diff;
        const tabs = await browser.tabs.query({ cookieStoreId });
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
        const [{ cookieStoreId }] = diff;
        const tabs = await browser.tabs.query({ cookieStoreId });
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

  describe('temporary containers', () => {
    context('when empty', () => {
      it('should be removed', async () => {
        const [container] = await containersCreated(async () =>
          app.handleBrowserAction(await browser.tabs.getCurrent())
        );
        const { cookieStoreId } = container;
        const [tab] = await browser.tabs.query({ cookieStoreId });
        const removals = events(browser.contextualIdentities.onRemoved);
        await browser.tabs.remove(tab.id);
        await until(
          removals,
          ({ contextualIdentity: removed }) =>
            removed.cookieStoreId === cookieStoreId
        );
      });
    });

    context('when renamed', () => {
      it('should no longer be temporary', async () => {
        const [{ cookieStoreId }] = await containersCreated(async () =>
          app.handleBrowserAction(await browser.tabs.getCurrent())
        );
        const [tab] = await browser.tabs.query({ cookieStoreId });
        await browser.contextualIdentities.update(cookieStoreId, {
          name: 'A Container',
        });
        await browser.tabs.remove(tab.id);
        // TODO wait for handlers to run somehow?
        const container = await browser.contextualIdentities.get(cookieStoreId);
        expect(container.name).to.equal('A Container');
      });
    });

    context('in large quantities', () => {
      it('should clean up tolerably quickly', async () => {
        const { containers, tabs } = await containersAndTabsCreated(
          async () => {
            const current = await browser.tabs.getCurrent();
            await Promise.all(
              Array.from({ length: 750 }).map(() =>
                app.handleBrowserAction(current)
              )
            );
          }
        );
        const removals = events(browser.contextualIdentities.onRemoved);
        const remaining = new Set(containers);
        console.time('large test');
        await Promise.all(tabs.map((id) => browser.tabs.remove(id)));
        for await (const {
          contextualIdentity: { cookieStoreId: removed },
        } of removals) {
          remaining.delete(removed);
          if (remaining.size === 0) {
            break;
          }
        }

        console.timeEnd('large test');
      });
    });
  });

  describe(`${CONTAINER_MARK} container`, () => {
    it('should become a new temporary container when created', async () => {
      const updates = events(browser.contextualIdentities.onUpdated);
      const { cookieStoreId } = await browser.contextualIdentities.create({
        name: CONTAINER_MARK,
        color: 'blue',
        icon: 'fence',
      });
      const {
        contextualIdentity: { name, icon },
      } = await until(
        updates,
        ({ contextualIdentity: updated }) =>
          updated.cookieStoreId === cookieStoreId
      );
      expect(name).to.match(/^Temp /);
      expect(icon).to.equal('circle');
      const tab = await browser.tabs.create({ cookieStoreId });
      const removals = events(browser.contextualIdentities.onRemoved);
      await browser.tabs.remove(tab.id);
      await until(
        removals,
        ({ contextualIdentity: removed }) =>
          removed.cookieStoreId === cookieStoreId
      );
    });

    it('should become a new temporary container when a tab is opened', async () => {
      const { cookieStoreId } = await browser.contextualIdentities.create({
        name: 'A container',
        color: 'blue',
        icon: 'fence',
      });
      // Updating the container's name should not cause the extension to absorb it
      await browser.contextualIdentities.update(cookieStoreId, {
        name: CONTAINER_MARK,
      });
      const updates = events(browser.contextualIdentities.onUpdated);
      const tab = await browser.tabs.create({ cookieStoreId });
      const { contextualIdentity: updated } = await until(
        updates,
        ({ contextualIdentity: updated }) =>
          updated.cookieStoreId === cookieStoreId &&
          updated.name !== CONTAINER_MARK
      );
      expect(updated.name).to.match(/^Temp /);
      const removals = events(browser.contextualIdentities.onRemoved);
      await browser.tabs.remove(tab.id);
      await until(
        removals,
        ({ contextualIdentity: removed }) =>
          removed.cookieStoreId === cookieStoreId
      );
    });
  });

  describe('removeEmptyTemporaryContainers()', () => {
    it('should remove empty temporary containers', async () => {
      const csids = await Promise.all(
        Array.from({ length: 4 }).map(async () => {
          const { cookieStoreId } = await app.createContainer();
          return cookieStoreId;
        })
      );
      await browser.tabs.create({ cookieStoreId: csids[0] });
      await browser.tabs.create({ cookieStoreId: csids[2] });
      await app.removeEmptyTemporaryContainers();
      expect(await browser.contextualIdentities.get(csids[0])).to.exist;
      await expectToReject(browser.contextualIdentities.get(csids[1]));
      expect(await browser.contextualIdentities.get(csids[2])).to.exist;
      await expectToReject(browser.contextualIdentities.get(csids[3]));
    });

    // TODO test these from outside the extension, possibly using "management"?
    it('should trigger on install');
    it('should trigger on update');
    it('should trigger on browser launch');
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
