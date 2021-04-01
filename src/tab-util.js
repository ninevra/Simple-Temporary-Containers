/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Returns the color name of the given tab's container, or undefined if there is
// none (e.g., the container is firefox-default)
export async function tabColor(tab) {
  const csid = tab.cookieStoreId;
  try {
    const container = await browser.contextualIdentities.get(csid);
    return container.color;
  } catch {
    return undefined;
  }
}

// Returns an array containing the container color names of every given tab that
// has one
export async function tabColors(...tabs) {
  return (await Promise.all(tabs.map((tab) => tabColor(tab)))).filter((c) => c);
}

// Returns the tabs.Tab of the rightmost tab in the given window
// TODO: can a window have 0 tabs?
export async function rightmostTab(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  return tabs[tabs.length - 1];
}

// Returns the tab following the given one, or undefined if there is none
export async function nextTab(tab) {
  const tabs = await browser.tabs.query({
    windowId: tab.windowId,
    index: tab.index + 1,
  });
  if (tabs.length > 0) {
    return tabs[0];
  }

  return undefined;
}
