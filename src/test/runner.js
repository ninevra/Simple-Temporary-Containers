mocha.setup('bdd');
mocha.checkLeaks();
mocha.timeout(0);

await import('./tests/integration.js');
await import('./tests/unit.js');
mocha.run();
