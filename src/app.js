/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { genName, isManagedContainer } from './container-util.js';
import { tabColor, tabColors, nextTab, rightmostTab, secondRightmostTab } from './tab-util.js';
import { randomColor, debug } from './util.js';

export class App {
  constructor() {
    // A Map whose keys are the cookieStoreIds of all containers managed here
    // and whose values are Sets of all tabIds open in the container
    this.containers = new Map();
    // A Map from tabIds to cookieStoreIds of all tabs managed by this extension
    this.tabs = new Map();

    // Bind event handlers, so that their registration is checkable in the
    // integration tests:

    // Handles browser starting with the extension installed
    // TODO: verify this is called correctly
    this.handleStartup = () => {
      this.rebuildDatabase();
    };

    // Handles extension being installed, reinstalled, or updated
    this.handleInstalled = async (details) => {
      // QUESTION: if this is an update, does the data still exist?
      await this.rebuildDatabase();
      if (details.temporary) {
        // Run tests
        await browser.tabs.create({ url: '/test/test.html' });
      }
    };

    // Handles tabs being opened
    // If the tab belongs to a recorded container, then records the tab
    this.handleTabCreated = async (tab) => {
      const cookieStoreId = tab.cookieStoreId;
      if (this.containers.has(cookieStoreId)) {
        this.addTabToDb(tab);
      } else if (cookieStoreId !== "firefox-default") {
        let container = await browser.contextualIdentities.get(cookieStoreId);
        if (container.name === "%TEMP%") {
          const name = await genName(container);
          const prev = await secondRightmostTab(tab.windowId);
          const denyList = prev ? [await tabColor(prev)] : [];
          const color = randomColor(...denyList);
          await browser.contextualIdentities.update(cookieStoreId, { icon: "circle", name, color });
          this.addContainerToDb(cookieStoreId);
          this.addTabToDb(tab);
        }
      }
    };

    // Handles tabs being closed
    // If the tab was recorded, then forget it
    // If the tab's container is now empty, then forget and destroy it
    this.handleTabRemoved = async (tabId, _removeInfo) => {
      // TODO: handle unexpected cases where container not recorded or doesn't
      // record the tab
      if (this.tabs.has(tabId)) {
        const cookieStoreId = this.tabs.get(tabId);
        this.forgetTab(tabId, cookieStoreId);
        if (this.isEmptyContainer(cookieStoreId)) {
          await this.forgetAndRemoveContainer(cookieStoreId);
        }
      }
    };

    // Handles the browserAction being clicked
    // Create a new container and an empty tab in that container
    this.handleBrowserAction = async (activeTab) => {
      // Tab will be created at end of window. banned colors: last tab in
      // window, current active tab
      const denyList = await tabColors(
        activeTab,
        await rightmostTab(activeTab.windowId)
      );
      const container = await this.createContainer(denyList);
      await browser.tabs.create({
        cookieStoreId: container.cookieStoreId,
      });
    };

    // Handles the menu item being clicked
    // Open a new container and a new tab with the given link
    this.handleMenuItem = async (info, tab) => {
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

        const container = await this.createContainer(denyList);
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

        const container = await this.createContainer(denyList);
        await browser.tabs.create({
          cookieStoreId: container.cookieStoreId,
          url: info.pageUrl,
          index: tab.index + 1,
          active: tab.active,
        });
      }
    };

    // If a managed container's name has been changed by the user, unmanage it
    this.handleIdentityUpdated = async ({ contextualIdentity: container }) => {
      debug.log('Continer updated', container);
      if (
        this.containers.has(container.cookieStoreId) &&
        !(await isManagedContainer(container))
      ) {
        this.forgetContainer(container.cookieStoreId);
      }
    };
  }

  connect() {
    // Setup & Register Event Handlers:

    browser.tabs.onRemoved.addListener(this.handleTabRemoved);
    browser.tabs.onCreated.addListener(this.handleTabCreated);
    browser.browserAction.onClicked.addListener(this.handleBrowserAction);
    browser.contextualIdentities.onUpdated.addListener(
      this.handleIdentityUpdated
    );
    browser.runtime.onStartup.addListener(this.handleStartup);
    browser.runtime.onInstalled.addListener(this.handleInstalled);

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

    browser.menus.onClicked.addListener(this.handleMenuItem);
  }

  // State Operations:

  // Creates, records, and returns a new temporary container
  async createContainer(denyList = []) {
    const color = randomColor(...denyList);
    const container = await browser.contextualIdentities.create({
      name: 'Temp',
      color,
      icon: 'circle',
    });
    const cookieStoreId = container.cookieStoreId;
    const name = await genName(container);
    await browser.contextualIdentities.update(cookieStoreId, { name });
    this.addContainerToDb(container.cookieStoreId);
    debug.log('created container', cookieStoreId);
    return container;
  }

  // Iterates through all containers and tabs to rebuild extension state
  async rebuildDatabase() {
    console.time('rebuildDatabase');
    // TODO: if this takes awhile, the results could be inconsistent, because a
    // tab could be removed before it is registered.  Unfortunately,
    // tabs.onRemoved() can be a tab's first lifecycle event, as when the
    // extension is reloaded or the browser restarted with a managed tab already
    // open.
    // Wipe previous data // QUESTION: can there ever be any?
    this.containers.clear();
    this.tabs.clear();
    // Check all extant containers
    const [allContainers, allTabs] = await Promise.all([
      browser.contextualIdentities.query({}),
      browser.tabs.query({}),
    ]);
    await Promise.all(
      allContainers.map(async (container) => {
        if (await isManagedContainer(container)) {
          const cookieStoreId = container.cookieStoreId;
          this.addContainerToDb(cookieStoreId);
        }
      })
    );
    for (const tab of allTabs) {
      if (this.containers.has(tab.cookieStoreId)) {
        this.addTabToDb(tab);
      }
    }

    await Promise.all(
      [...this.containers.keys()].map(async (cookieStoreId) => {
        if (this.isEmptyContainer(cookieStoreId)) {
          await this.forgetAndRemoveContainer(cookieStoreId);
        }
      })
    );
    console.timeEnd('rebuildDatabase');
    debug.log('Rebuilt database is', this.containers, this.tabs);
  }

  // Records a tab in the extension state
  // TODO: handle case where tab is not in a known container
  addTabToDb(tab) {
    debug.log('Recording tab', tab.id, 'in container', tab.cookieStoreId);
    this.tabs.set(tab.id, tab.cookieStoreId);
    this.containers.get(tab.cookieStoreId).add(tab.id);
  }

  // Records a container in the extension state
  addContainerToDb(cookieStoreId) {
    debug.log('Recording temporary container:', cookieStoreId);
    // TODO: this check should always be true
    if (!this.containers.has(cookieStoreId)) {
      this.containers.set(cookieStoreId, new Set());
    }
  }

  // Forgets a tab from the extension state
  // TODO: handle case where tab is not in a known container
  forgetTab(tabId, cookieStoreId) {
    debug.log('Forgetting tab', tabId, 'in container', cookieStoreId);
    this.tabs.delete(tabId);
    this.containers.get(cookieStoreId).delete(tabId);
  }

  // Checks whether a container is believed to be empty
  isEmptyContainer(cookieStoreId) {
    const containerTabs = this.containers.get(cookieStoreId);
    return containerTabs.size === 0;
  }

  forgetContainer(cookieStoreId) {
    debug.log('Forgetting container', cookieStoreId);
    this.containers.delete(cookieStoreId);
  }

  async removeContainer(cookieStoreId) {
    debug.log('Removing container', cookieStoreId);
    await browser.contextualIdentities.remove(cookieStoreId);
  }

  // Forgets a container from the extension state and destroys it
  async forgetAndRemoveContainer(cookieStoreId) {
    this.forgetContainer(cookieStoreId);
    await this.removeContainer(cookieStoreId);
    // QUESTION: An "Error: Invalid tab ID" is always logged after this, with
    // the ID of the last tab removed. Is this a problem? Is it avoidable?
  }
}
