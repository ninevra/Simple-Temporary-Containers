/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

describe('unit tests', function () {
  let background = browser.extension.getBackgroundPage();

  describe('truncatedHash()', function () {
    let truncatedHash = background.truncatedHash;
    let strings = ["test string", "hello world", ""];
    let expectation = [
      "661295c9cbf9d6b2f6428414504a8deed3020641",
      "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed",
      "da39a3ee5e6b4b0d3255bfef95601890afd80709"
    ];

    it('should SHA1 hash a string', async function () {
      let hashes = await Promise.all(strings.map(
        (string) => truncatedHash(string, 40)
      ));
      for (let i = 0; i < strings.length; i++) {
        expect(hashes[i]).to.equal(expectation[i]);
      }
    });

    it('should truncate hashes', async function () {
      for (let length in [0, 1, 4, 12, 40, 41]) {
        let hashes = await Promise.all(strings.map(
          (string) => truncatedHash(string, length)
        ));
        for (let i = 0; i < strings.length; i++) {
          expect(hashes[i]).to.equal(expectation[i].substring(0, 2 * length))
        }
      }
    });
  });

  describe('hash-related utilities', function () {

    describe('toHexString()', function () {
      let toHexString = background.toHexString;

      it('should convert Uint8Arrays to hexadecimal strings', function () {
        expect(toHexString(Uint8Array.of(255))).to.equal('ff');
      });

      it('should always use two digits for each byte', function () {
        expect(toHexString(Uint8Array.of(0))).to.equal('00');
        expect(toHexString(Uint8Array.of(15, 0, 200, 9))).to.equal('0f00c809');
      });
    });

    describe('concatBuffers()', function () {
      let concatBuffers = background.concatBuffers;

      it('should concatenate the provided ArrayBuffers', function () {
        expect(concatBuffers()).to.be.an('arraybuffer').that.has.property('byteLength', 0);
        let buffers = [
          Uint8Array.of(255, 1).buffer,
          Uint8Array.of().buffer,
          Uint8Array.of(0, 10, 0).buffer,
          Uint8Array.of(100, 156, 34).buffer,
          Uint8Array.of(255, 1).buffer
        ];
        let result1 = concatBuffers(buffers[0]);
        expect(result1).to.be.an('arraybuffer').that.has.property('byteLength', 2);
        expect([...new Uint8Array(result1)]).to.have.ordered.members([255, 1]);
        let result2 = concatBuffers(buffers[0], buffers[1]);
        expect(result2).to.be.an('arraybuffer').that.has.property('byteLength', 2);
        expect([...new Uint8Array(result2)]).to.have.ordered.members([255, 1]);
        let result3 = concatBuffers(...buffers);
        expect(result3).to.be.an('arraybuffer').that.has.property('byteLength', 10);
        expect([...new Uint8Array(result3)]).to.have.ordered.members([255, 1, 0, 10, 0, 100, 156, 34, 255, 1]);
      });
    });

    describe('hashConcat()', function () {
      let hashConcat = background.hashConcat;

      it('should return a SHA-1 hash', async function () {
        expect(await hashConcat('')).to.match(/[0-9a-z]{40}/);
        expect(await hashConcat('hello', 'again', 'world')).to.match(/[0-9a-z]{40}/);
      });

      it('should incorporate each string', async function () {
        expect(await hashConcat('a')).to.not.equal(await hashConcat('a', ''));
        expect(await hashConcat('a', '')).to.not.equal(await hashConcat('a', '', 'jabberwock'));
      });

      it("should not collide on e.g. ['hello', 'world'] and ['hell', 'oworld']", async function () {
        expect(await hashConcat('hello', 'world'))
          .to.equal(await hashConcat('hello', 'world'))
          .and.not.equal(await hashConcat('hell', 'oworld'));
      });
    });

    describe('hashList()', function () {
      let hashList = background.hashList;

      it('should return a SHA-1 hash', async function () {
        expect(await hashList('')).to.match(/[0-9a-z]{40}/);
        expect(await hashList('hello', 'again', 'world')).to.match(/[0-9a-z]{40}/);
      });

      it('should incorporate each string', async function () {
        expect(await hashList('a')).to.not.equal(await hashList('a', ''));
        expect(await hashList('a', '')).to.not.equal(await hashList('a', '', 'jabberwock'));
      });

      it("should not collide on ['hello', 'world'] and ['hell', 'oworld']", async function () {
        expect(await hashList('hello', 'world'))
          .to.equal(await hashList('hello', 'world'))
          .and.not.equal(await hashList('hell', 'oworld'));
      });
    });

    describe('sha1()', function () {
      let sha1 = background.sha1;
      let strings = ["test string", "hello world", ""];
      let expectation = [
        "661295c9cbf9d6b2f6428414504a8deed3020641",
        "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed",
        "da39a3ee5e6b4b0d3255bfef95601890afd80709"
      ];

      it('should SHA-1 hash a string', async function () {
        let hashes = await Promise.all(strings.map(
          (string) => sha1(string)
        ));
        for (let i = 0; i < strings.length; i++) {
          expect(hashes[i]).to.equal(expectation[i]);
        }
      });
    });
  });

  describe('isManagedContainer()', function () {
    let isManagedContainer = background.isManagedContainer;

    it('should recognize containers created under 0.1.0', async function () {
      let containers = [
        {
          "name": "Temp 4578b21d",
          "icon": "circle",
          "iconUrl": "resource://usercontext-content/circle.svg",
          "color": "blue",
          "colorCode": "#37adff",
          "cookieStoreId": "firefox-container-3471"
        },
        {
          "name": "Temp 42e9dcea",
          "icon": "circle",
          "iconUrl": "resource://usercontext-content/circle.svg",
          "color": "green",
          "colorCode": "#51cd00",
          "cookieStoreId": "firefox-container-5799"
        }
      ];
      for (let container of containers) {
        expect(await isManagedContainer(container)).to.be.true;
      }
    });

    it('should recognize current containers', async function () {
      let containers = [
        {
          "icon": "circle",
          "iconUrl": "resource://usercontext-content/circle.svg",
          "color": "blue",
          "colorCode": "#37adff",
          "cookieStoreId": "firefox-container-3471"
        },
        {
          "icon": "circle",
          "iconUrl": "resource://usercontext-content/circle.svg",
          "color": "green",
          "colorCode": "#51cd00",
          "cookieStoreId": "firefox-container-5799"
        }
      ];
      for (let container of containers) {
        container.name = await background.genName(container);
        expect(await isManagedContainer(container)).to.be.true;
      }
    });

    it('should not recognize non-temporary containers', async function () {
      let containers = [
        {
          "name": "Shopping",
          "icon": "circle",
          "iconUrl": "resource://usercontext-content/circle.svg",
          "color": "blue",
          "colorCode": "#37adff",
          "cookieStoreId": "firefox-container-3471"
        },
        {
          "name": "Temp a1a1a1a1",
          "icon": "circle",
          "iconUrl": "resource://usercontext-content/circle.svg",
          "color": "green",
          "colorCode": "#51cd00",
          "cookieStoreId": "firefox-container-5799"
        }
      ];
      for (let container of containers) {
        expect(await isManagedContainer(container)).to.be.false;
      }
    });
  });

});
