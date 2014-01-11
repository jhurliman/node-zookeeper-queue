var assert  = require('assert');
var zkQueue = require('../lib/zookeeperQueue');

var randStr = Math.random().toString(36).substring(7, 15);
var queuePath = '/queuetest-' + randStr;
var pubQueue;
var subQueue;
var message;

suite('Basic PubSub Queueing', function() {

  test('connect to queue', function(done) {
    pubQueue = new zkQueue.PubQueue({ path: queuePath })
      .on('connect', done);
  });

  test('publish to queue', function(done) {
    pubQueue.write(randStr, done);
  });

  test('subscribe to queue', function(done) {
    subQueue = new zkQueue.SubQueue({ path: queuePath })
      .on('data', function(data) {
        message = data;
      })
      .on('connect', done);
  });

  test('receive previously queued item', function(done) {
    waitUntil(function() { return message; },
      function() {
        assert.equal(message.toString(), randStr);
        message = undefined;
        done();
      });
  });

  test('publish to queue again', function(done) {
    randStr = Math.random().toString(36).substring(7, 15);
    pubQueue.write(randStr, done);
  });

  test('receive newly queued item', function(done) {
    waitUntil(function() { return message; },
      function() {
        assert.equal(message.toString(), randStr);
        message = undefined;
        done();
      });
  });

  test('disconnect', function(done) {
    var subClosed = false;
    var pubClosed = false;

    subQueue.once('close', function() { subClosed = true; });
    pubQueue.once('close', function() { pubClosed = true; });

    subQueue.destroy();

    pubQueue.zooClient.remove(queuePath, function(err) {
      assert.ifError(err);
      pubQueue.end();
    });

    waitUntil(function() { return pubClosed && subClosed; }, done);
  });

});

function waitUntil(test, callback) {
  var timer = setInterval(function() {
    if (!test()) return;

    clearInterval(timer);
    callback();
  }, 25);
}
