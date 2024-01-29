/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { toHexString, hashConcat, randomColor, sha1 } from './util.js';

// Generates a name for the given container
// Name incorporates a random byte and a hash of that byte and the container's
// cookieStoreId
export async function genName(container) {
  // A random byte
  const seedByte = crypto.getRandomValues(new Uint8Array(1));
  // A hexadecimal string encoding the random byte
  const seedString = toHexString(seedByte);
  // A hash value
  const hash = await hashConcat(seedString, container.cookieStoreId);
  return 'Temp ' + seedString + hash.slice(0, 6);
}

const managedContainerChecks = new Map();
managedContainerChecks.set('0.1.0', async (container) => {
  const match = container.name.match(/^Temp ([a-f\d]{8})$/);
  const hash = await sha1(container.cookieStoreId);
  return match && match[1] === hash.slice(0, 8);
});
managedContainerChecks.set('0.2.0', async (container) => {
  const match = container.name.match(/^Temp ([a-f\d]{2})([a-f\d]{6}$)/);
  if (match) {
    const [, seed, hash] = match;
    const fullExpectedHash = await hashConcat(seed, container.cookieStoreId);
    const expectation = fullExpectedHash.slice(0, 6);
    if (hash === expectation) {
      return true;
    }
  }

  return false;
});

// Checks whether a container's name is consistent with containers produced by
// App.prototype.createContainer. Any such container is considered managed by
// this extension, and will be deleted when empty.
export async function isManagedContainer(container) {
  if (container.name.startsWith('Temp ')) {
    // TODO could use Promise.any or p-locate to speed this up a bit, at the
    // cost of a bit of clarity
    const checks = await Promise.all(
      [...managedContainerChecks.values()].map((check) => check(container))
    );
    return checks.some(Boolean);
  }

  return false;
}

export const CONTAINER_MARK = '%NEW_TEMP_CONTAINER%';

// Determines whether a container is marked for intake and should be turned
// into a temporary container.
export function isMarkedContainer(container) {
  return container.name === CONTAINER_MARK;
}

// Turns the given container into a temporary container
export async function makeContainerTemporary(container) {
  const { cookieStoreId } = container;
  const name = await genName(container);
  const color = randomColor();
  return await browser.contextualIdentities.update(cookieStoreId, {
    icon: 'circle',
    name,
    color,
  });
}
