/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

describe('unit tests', () => {
  const background = browser.extension.getBackgroundPage();

  describe('hash-related utilities', () => {
    describe('toHexString()', () => {
      const toHexString = background.toHexString;

      it('should convert Uint8Arrays to hexadecimal strings', () => {
        expect(toHexString(Uint8Array.of(255))).to.equal('ff');
      });

      it('should always use two digits for each byte', () => {
        expect(toHexString(Uint8Array.of(0))).to.equal('00');
        expect(toHexString(Uint8Array.of(15, 0, 200, 9))).to.equal('0f00c809');
      });
    });

    describe('hashConcat()', () => {
      const hashConcat = background.hashConcat;

      it('should return a SHA-1 hash', async () => {
        expect(await hashConcat('')).to.match(/[\da-z]{40}/);
        expect(await hashConcat('hello', 'again', 'world')).to.match(
          /[\da-z]{40}/
        );
      });

      it('should incorporate each string', async () => {
        expect(await hashConcat('a')).to.not.equal(await hashConcat('a', ''));
        expect(await hashConcat('a', '')).to.not.equal(
          await hashConcat('a', '', 'jabberwock')
        );
      });

      it("should not collide on e.g. ['hello', 'world'] and ['hell', 'oworld']", async () => {
        expect(await hashConcat('hello', 'world'))
          .to.equal(await hashConcat('hello', 'world'))
          .and.not.equal(await hashConcat('hell', 'oworld'));
      });
    });

    describe('sha1()', () => {
      const sha1 = background.sha1;
      const strings = ['test string', 'hello world', ''];
      const expectation = [
        '661295c9cbf9d6b2f6428414504a8deed3020641',
        '2aae6c35c94fcfb415dbe95f408b9ce91ee846ed',
        'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      ];

      it('should SHA-1 hash a string', async () => {
        const hashes = await Promise.all(strings.map((string) => sha1(string)));
        for (let i = 0; i < strings.length; i++) {
          expect(hashes[i]).to.equal(expectation[i]);
        }
      });
    });
  });

  describe('isManagedContainer()', () => {
    const isManagedContainer = background.isManagedContainer;

    it('should recognize containers created under 0.1.0', async () => {
      const containers = [
        {
          name: 'Temp 4578b21d',
          icon: 'circle',
          iconUrl: 'resource://usercontext-content/circle.svg',
          color: 'blue',
          colorCode: '#37adff',
          cookieStoreId: 'firefox-container-3471',
        },
        {
          name: 'Temp 42e9dcea',
          icon: 'circle',
          iconUrl: 'resource://usercontext-content/circle.svg',
          color: 'green',
          colorCode: '#51cd00',
          cookieStoreId: 'firefox-container-5799',
        },
      ];
      for (const container of containers) {
        expect(await isManagedContainer(container)).to.be.true;
      }
    });

    it('should recognize current containers', async () => {
      const containers = [
        {
          icon: 'circle',
          iconUrl: 'resource://usercontext-content/circle.svg',
          color: 'blue',
          colorCode: '#37adff',
          cookieStoreId: 'firefox-container-3471',
        },
        {
          icon: 'circle',
          iconUrl: 'resource://usercontext-content/circle.svg',
          color: 'green',
          colorCode: '#51cd00',
          cookieStoreId: 'firefox-container-5799',
        },
      ];
      for (const container of containers) {
        container.name = await background.genName(container);
        expect(await isManagedContainer(container)).to.be.true;
      }
    });

    it('should not recognize non-temporary containers', async () => {
      const containers = [
        {
          name: 'Shopping',
          icon: 'circle',
          iconUrl: 'resource://usercontext-content/circle.svg',
          color: 'blue',
          colorCode: '#37adff',
          cookieStoreId: 'firefox-container-3471',
        },
        {
          name: 'Temp a1a1a1a1',
          icon: 'circle',
          iconUrl: 'resource://usercontext-content/circle.svg',
          color: 'green',
          colorCode: '#51cd00',
          cookieStoreId: 'firefox-container-5799',
        },
      ];
      for (const container of containers) {
        expect(await isManagedContainer(container)).to.be.false;
      }
    });
  });
});
