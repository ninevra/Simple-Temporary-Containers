export {}; // Ensure this is run as an ecmascript module

mocha.setup('bdd');
mocha.checkLeaks();
mocha.timeout(0);
window.expect = chai.expect;

(async () => {
  await import('./tests/integration.js');
  await import('./tests/unit.js');
  mocha.run();
})();
