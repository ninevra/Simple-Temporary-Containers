describe('Array', function() {
  describe('#indexOf()', function() {
    it('should return -1 when the value is not present', function() {
      expect([1, 2, 3].indexOf(4)).to.equal(-1);
    });
  });
});

describe('browser.tabs', function () {
  describe('#create()', function() {
    it('should return a Promised active tab', async function () {
      let tab = await browser.tabs.create({});
      expect(tab.active).to.be.true;
      await browser.tabs.remove([tab.id]);
    });
  });
});
