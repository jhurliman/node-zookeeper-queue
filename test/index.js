#!/usr/bin/env node

var Mocha = require('mocha');

var mocha = new Mocha();
mocha.reporter('spec').ui('tdd');

mocha.addFile('test/basicPubSub.js');

var runner = mocha.run(function(failures) {
  process.exit(failures);
});
