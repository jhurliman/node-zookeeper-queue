'use strict';
const { EventEmitter } = require('node:events');
function error(name) { return Object.assign(new Error(name), { name }); }
class Server {
  constructor() { this.items = new Map(); this.watchers = new Map(); this.sequence = 0; }
  notify() {
    const callbacks = [...this.watchers.values()].flatMap(set => [...set]);
    this.watchers.clear();
    for (const callback of callbacks) queueMicrotask(callback);
  }
}
class Client extends EventEmitter {
  constructor(server = new Server()) {
    super(); this.server = server; this.closed = false; this.closeCount = 0;
    this.inFlight = 0; this.maximum = 0; this.childReads = 0;
  }
  connect() { queueMicrotask(() => this.emit('connected')); }
  close() { this.closed = true; this.closeCount++; this.server.watchers.delete(this); }
  operation(action) {
    this.maximum = Math.max(this.maximum, ++this.inFlight);
    queueMicrotask(() => { this.inFlight--; action(); });
  }
  mkdirp(path, data, acls, mode, callback) { this.pathAcls = acls; this.operation(() => callback(null)); }
  create(path, data, acls, mode, callback) {
    this.itemAcls = acls;
    this.operation(() => {
      if (this.closed) return callback(error('CONNECTION_LOSS'));
      const name = 'queue-' + String(this.server.sequence++).padStart(10, '0');
      this.server.items.set(name, Buffer.from(data)); this.server.notify(); callback(null, name);
    });
  }
  getChildren(path, watcher, callback) {
    this.childReads++;
    if (!callback) { callback = watcher; watcher = null; }
    this.operation(() => {
      if (watcher) {
        if (!this.server.watchers.has(this)) this.server.watchers.set(this, new Set());
        this.server.watchers.get(this).add(watcher);
      }
      callback(null, [...this.server.items.keys()]);
    });
  }
  getData(path, callback) {
    this.operation(() => {
      const value = this.server.items.get(path.split('/').at(-1));
      callback(value === undefined ? error('NO_NODE') : null, value);
    });
  }
  remove(path, callback) {
    this.operation(() => {
      if (!this.server.items.delete(path.split('/').at(-1))) return callback(error('NO_NODE'));
      this.server.notify(); callback(null);
    });
  }
}
module.exports = { Server, Client, error };
