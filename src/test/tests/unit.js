describe('truncatedHash()', function () {
  let truncatedHash = browser.extension.getBackgroundPage().truncatedHash;
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

describe('genName()', function () {

  let genName;

  before(async function () {
    genName = (await browser.runtime.getBackgroundPage()).genName;
  });

  it('should produce different names for containers with different cookieStoreIds', async function () {
    let name1 = await genName({cookieStoreId: "OneTwo", color: "Three"});
    let name2 = await genName({cookieStoreId: "One", color: "TwoThree"});
    expect(name1).to.not.equal(name2);
  });

  it('should produce the same name for container with same cookieStoreId', async function () {
    let name1 = await genName({cookieStoreId: "csid", color: "blue", name: "hi"});
    let name2 = await genName({cookieStoreId: "csid", color: "turquoise", name: "hi"});
    let name3 = await genName({cookieStoreId: "csid", color: "blue", name: "world"});
    expect(name2).to.equal(name1);
    expect(name3).to.equal(name1);
  });
});
