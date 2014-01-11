var zookeeper = require('node-zookeeper-client');
var CreateMode = zookeeper.CreateMode;
var async = require('async');
var stream = require('stream');
var Readable = stream.Readable;
var Writable = stream.Writable;
var util = require('util');

var PREFIX = 'queue-';
var FORMAT_REGEX = /queue-\d{10}/;

/******************************************************************************
 * PubQueue
 *****************************************************************************/

var ZookeeperPubQueue = exports.PubQueue = function(options) {
  if (!(this instanceof ZookeeperPubQueue))
    return new ZookeeperPubQueue(options);

  Writable.call(this, { objectMode: true });

  initQueue(this, false, options);
};

util.inherits(ZookeeperPubQueue, Writable);

ZookeeperPubQueue.prototype._write = function(data, encoding, callback) {
  if (!this.connected)
    return callback('Not connected');

  if (!(data instanceof Buffer)) {
    if (typeof data !== 'string')
      data = JSON.stringify(data);
    data = new Buffer(data);
  }

  this.zooClient.create(this.path + '/' + PREFIX, data,
    CreateMode.PERSISTENT_SEQUENTIAL, callback);
};

ZookeeperPubQueue.prototype.pause = function() {
  this.paused = true;
  Writable.prototype.pause.call(this);
};

ZookeeperPubQueue.prototype.resume = function() {
  this.paused = false;
  Writable.prototype.resume.call(this);
};

ZookeeperPubQueue.prototype.end = function() {
  this.paused = true;
  this.ended = true;
  this.zooClient.close();
  Writable.prototype.end.call(this);
};

/******************************************************************************
 * SubQueue
 *****************************************************************************/

var ZookeeperSubQueue = exports.SubQueue = function(options) {
  if (!(this instanceof ZookeeperSubQueue))
    return new ZookeeperSubQueue(options);

  Readable.call(this, { objectMode: true });

  initQueue(this, true, options);
};

util.inherits(ZookeeperSubQueue, Readable);

ZookeeperSubQueue.prototype._read = function() {
  var self = this;

  if (!this.paused || this.ended) return;
  this.paused = false;

  this._subscribe();
};

ZookeeperSubQueue.prototype._subscribe = function() {
  if (this.paused || !this.connected) return;

  var self = this;

  this.log('debug', 'Subscribing to ' + this.path);

  this.zooClient.getChildren(this.path, watchHandler, function(err, children) {
    if (err) return self.emit('error', err);

    var items = sortQueueItems(children);

    self.log('debug', 'Subscribed to ' + self.path + ' with ' + items.length + ' items');

    if (items.length)
      getQueueItem(self, self.path + '/' + items[0]);
  });

  function watchHandler(evt) {
    getQueueItem(self, null);
    self._subscribe();
  }
};

ZookeeperSubQueue.prototype.pause = function() {
  this.paused = true;
  Readable.prototype.pause.call(this);
};

ZookeeperSubQueue.prototype.resume = function() {
  this.paused = false;
  Readable.prototype.resume.call(this);
};

ZookeeperSubQueue.prototype.destroy = function() {
  this.paused = true;
  this.ended = true;
  this.zooClient.close();
  this.zooClient = undefined;
};

/******************************************************************************
 * Helper Methods
 *****************************************************************************/

function initQueue(queue, readable, options) {
  options = options || {};
  if (!options.path)
    throw new Error('Missing required "path"');

  queue.log = (typeof options.log === 'function') ? options.log : noOp;
  queue.connected = false;
  queue.created = false;
  if (readable) {
    queue.paused = true;
    queue.ended = false;
  }
  queue.path = options.path;
  queue.zooClient = createClient(options);

  queue.zooClient.on('connected', function() {
    queue.connected = true;
    queue.log('info', 'Connected to ZooKeeper');

    if (!queue.created)
      return create();

    queue.emit('connect');
    if (readable)
      queue._subscribe();
  }).on('disconnected', function() {
    queue.connected = false;
    queue.log('info', 'Disconnected from ZooKeeper');
    if (queue.ended)
      queue.emit('close');
  }).on('error', function(err) {
    queue.log('error', err);
    queue.emit('error', err);
  });

  queue.log('debug', 'Connecting to ZooKeeper');
  queue.zooClient.connect();

  function create() {
    queue.log('debug', 'Creating ' + queue.path + ' if it does not already exist');

    queue.zooClient.create(queue.path, null, CreateMode.PERSISTENT, function(err) {
      if (err) {
        if (err.name !== 'NODE_EXISTS')
          return queue.emit('error', err);

        queue.log('debug', queue.path + ' already exists');
      } else {
        queue.log('debug', 'Created ' + queue.path);
      }

      queue.created = true;
      queue.emit('connect');
      if (readable)
        queue._subscribe();
    });
  }
}

function createClient(options) {
  if (options.client)
    return options.client;

  var host = options.host || '127.0.0.1';
  var port = options.port || 2181;
  var connectionStr = host + ':' + port;
  var sessionTimeout = options.timeout || 30 * 1000;
  var spinDelay = options.delay || 5 * 1000;
  var retries = options.retries || 12;

  return zookeeper.createClient(connectionStr,
    { sessionTimeout: sessionTimeout, spinDelay: spinDelay, retries: retries });
}

function getQueueItem(queue, itemPath) {
  if (queue.paused) return;

  var finished = false;
  var itemData;

  async.whilst(
    function() { return !queue.paused && !finished; },
    function(done) {
      // If no itemPath was given...
      if (!itemPath) return getNextItemPath(done);

      queue.log('debug', 'Retrieving queue item ' + itemPath);

      // Try to get the item
      queue.zooClient.getData(itemPath, function(err, data, stat) {
        if (err) return getNextItemPath(done);

        if (queue.paused) return done();
        queue.log('debug', 'Removing queue item ' + itemPath);

        // Try to delete the item
        queue.zooClient.remove(itemPath, function(err) {
          if (err) return getNextItemPath(done);

          finished = true;
          itemData = data;
          done();
        });
      });
    },
    function(err) {
      if (err) return queue.emit('error', err);

      if (itemData) {
        queue.log('debug', 'Successfully dequeued ' + itemPath);
        var pause = !queue.push(itemData);
        if (pause !== queue.paused) {
          if (pause)
            queue.paused = true;
          else
            queue._read();
        }
      } else {
        queue.log('debug', 'Queue is empty');
      }
    }
  );

  function getNextItemPath(done) {
    if (queue.ended) return done();

    // Fetch all pending queue items
    queue.zooClient.getChildren(queue.path, function(err, children) {
      if (err) return done(err);

      // Filter and sort by oldest first
      var items = sortQueueItems(children);
      if (!items.length) {
        finished = true;
        return done();
      }

      itemPath = queue.path + '/' + items[0];
      done();
    });
  }
}

function sortQueueItems(items) {
  var LEN = PREFIX.length;

  return items
    .filter(function(name) { return FORMAT_REGEX.test(name); })
    .sort(function(a, b) { return Number(a.substr(LEN)) - Number(b.substr(LEN)); });
}

function noOp() { }
