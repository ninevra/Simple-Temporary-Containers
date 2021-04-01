/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// A utf-8 TextEncoder
const utf8Encoder = new TextEncoder();
// An array of all names of allowed container colors
const colors = [
  'blue',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
];

async function hash(string, hashType) {
  const buffer = utf8Encoder.encode(string);
  const hashBuffer = await crypto.subtle.digest(hashType, buffer);
  const bytes = new Uint8Array(hashBuffer);
  return toHexString(bytes);
}

export async function sha1(string) {
  return hash(string, 'SHA-1');
}

// Returns a hexadecimal string encoding the provided Uint8Array
export function toHexString(byteArray) {
  return [...byteArray].map((i) => i.toString(16).padStart(2, '0')).join('');
}

// Returns a hash of the input strings, constructed by hashing the concatenation
// of them and their lengths
export async function hashConcat(...strings) {
  const data = strings.map((s) => `${s.length.toString(16)}.${s}`).join('');
  return sha1(data);
}

// Returns a container color, chosen at random, excluding the arguments
export function randomColor(...denyList) {
  denyList = new Set(denyList);
  return randomChoice(...colors.filter((color) => !denyList.has(color)));
}

// Returns one of its arguments, chosen at random
function randomChoice(...options) {
  return options[Math.floor(Math.random() * options.length)];
}
