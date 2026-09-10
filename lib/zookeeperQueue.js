'use strict';
const zookeeper = require('node-zookeeper-client');
const { Readable, Writable } = require('node:stream');
const { inherits } = require('node:util');
const PREFIX = 'queue-';
const ITEM = /^queue-\d{10}$/;

function call(client, method, ...args) {
  return new Promise((resolve, reject) => client[method](...args,
    (error, result) => error ? reject(error) : resolve(result)));
}

function nodeMissing(error) { return error && error.name === 'NO_NODE'; }

function initialize(queue, options) {
  if (!options || typeof options.path !== 'string' || !options.path.startsWith('/') ||
      options.path === '/' || options.path.endsWith('/')) {
    throw new TypeError('path must be an absolute non-root ZooKeeper path without a trailing slash');
  }
  queue.path = options.path;
  queue._acls = options.acls ?? zookeeper.ACL.OPEN_ACL_UNSAFE;
  queue.log = typeof options.log === 'function' ? options.log : () => {};
  queue.connected = false;
  queue._generation = 0;
  queue.ended = false;
  queue.zooClient = options.client || zookeeper.createClient(
    options.connectionString || `${options.host || '127.0.0.1'}:${options.port ?? 2181}`, {
      sessionTimeout: options.timeout ?? 30000,
      spinDelay: options.delay ?? 5000,
      retries: options.retries ?? 12,
    });
  queue._ready = new Promise((resolve, reject) => { queue._resolveReady = resolve; queue._rejectReady = reject; });
  queue._ready.catch(() => {});
  const client = queue.zooClient;
  queue._listeners = {
    connected: async () => {
      const generation = ++queue._generation;
      try {
        await call(client, 'mkdirp', queue.path, null, queue._acls, zookeeper.CreateMode.PERSISTENT);
        if (queue.destroyed || generation !== queue._generation) return;
        queue.connected = true;
        queue.log('info', 'Connected to ZooKeeper');
        queue._resolveReady();
        queue.emit('connect');
        if (queue._pump) queue._pump();
      } catch (error) { if (!queue.destroyed && generation === queue._generation) queue.destroy(error); }
    },
    disconnected: () => { queue._generation++; queue.connected = false; if (queue._items) queue._items = []; queue.log('info', 'Disconnected from ZooKeeper'); },
    expired: () => queue.destroy(new Error('ZooKeeper session expired; create a new queue')),
    authenticationFailed: () => queue.destroy(new Error('ZooKeeper authentication failed')),
    error: error => queue.destroy(error),
  };
  for (const [event, handler] of Object.entries(queue._listeners)) client.on(event, handler);
  client.connect();
}

function destroy(error, callback) {
  this.connected = false;
  this.ended = true;
  this._rejectReady(error || new Error('Queue destroyed before becoming ready'));
  for (const [event, handler] of Object.entries(this._listeners)) this.zooClient.removeListener(event, handler);
  try { this.zooClient.close(); } catch (closeError) { error ||= closeError; }
  callback(error);
}

function PubQueue(options) {
  if (!(this instanceof PubQueue)) return new PubQueue(options);
  Writable.call(this, { objectMode: true, highWaterMark: options?.highWaterMark ?? 16 });
  initialize(this, options);
}
inherits(PubQueue, Writable);
PubQueue.prototype._destroy = destroy;
PubQueue.prototype._write = function(data, encoding, callback) {
  this._ready.then(() => {
    if (this.destroyed || !this.connected) throw new Error('ZooKeeper is not connected');
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    }
    return call(this.zooClient, 'create', `${this.path}/${PREFIX}`, data, this._acls,
      zookeeper.CreateMode.PERSISTENT_SEQUENTIAL);
  }).then(() => callback(), callback);
};
PubQueue.prototype._final = function(callback) { callback(); };

function SubQueue(options) {
  if (!(this instanceof SubQueue)) return new SubQueue(options);
  Readable.call(this, { objectMode: true, highWaterMark: options?.highWaterMark ?? 16 });
  this._demand = false;
  this._pumping = false;
  this._dirty = false;
  this._watching = false;
  this._items = [];
  initialize(this, options);
}
inherits(SubQueue, Readable);
SubQueue.prototype._destroy = destroy;
SubQueue.prototype._read = function() {
  this._demand = true;
  this._pump();
};
SubQueue.prototype._pump = async function() {
  this._dirty = true;
  if (this._pumping || !this._demand || !this.connected || this.destroyed) return;
  this._pumping = true;
  try {
    while (this._demand && this.connected && !this.destroyed) {
      this._dirty = false;
      if (!this._items.length) {
        const args = [this.path];
        if (!this._watching) {
          this._watching = true;
          args.push(() => {
            this._watching = false;
            this._pump();
          });
        }
        const children = await call(this.zooClient, 'getChildren', ...args);
        if (!this._demand || !this.connected || this.destroyed) break;
        this._items = children.filter(name => ITEM.test(name)).sort().reverse();
      }
      const next = this._items.pop();
      if (!next) break;
      const path = `${this.path}/${next}`;
      let data;
      try {
        data = await call(this.zooClient, 'getData', path);
        if (this.destroyed || !this.connected) break;
        // Only the consumer that successfully deletes the node delivers it.
        await call(this.zooClient, 'remove', path);
      } catch (error) {
        if (nodeMissing(error)) continue;
        throw error;
      }
      if (!this.destroyed) this._demand = this.push(data);
    }
  } catch (error) {
    this._watching = false;
    if (!this.destroyed) this.destroy(error);
  } finally {
    this._pumping = false;
    if (this._dirty && this._demand && this.connected && !this.destroyed) {
      queueMicrotask(() => this._pump());
    }
  }
};

exports.PubQueue = PubQueue;
exports.SubQueue = SubQueue;
