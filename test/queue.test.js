'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');
const { PubQueue, SubQueue } = require('..');
const { Server, Client, error } = require('./fake-client');
const tick = () => new Promise(resolve => setImmediate(resolve));
function seed(server, count) {
  for (let i = 0; i < count; i++) server.items.set(`queue-${String(i).padStart(10, '0')}`, Buffer.from(String(i)));
  server.sequence = count;
}

test('end(chunk) drains every buffered write before closing, including pre-connect writes', async () => {
  const client = new Client();
  const pub = PubQueue({ path: '/queue', client });
  pub.write('first'); pub.write({ message: 'second' }); pub.end(Buffer.from('last'));
  await finished(pub);
  assert.deepEqual([...client.server.items.values()].map(b => b.toString()), ['first', '{"message":"second"}', 'last']);
  assert.equal(client.closeCount, 1);
  assert.equal(pub.destroyed, true);
});

test('serialization failures become stream errors and close once', async () => {
  const client = new Client(); const pub = new PubQueue({ path: '/queue', client });
  const circular = {}; circular.self = circular;
  const result = finished(pub);
  pub.end(circular);
  await assert.rejects(result, /circular/i);
  assert.equal(client.closeCount, 1);
});

test('destroy before connection cancels queued writes without creating nodes', async () => {
  const client = new Client(); const pub = new PubQueue({ path: '/queue', client });
  const result = finished(pub); pub.write('never'); pub.destroy();
  await assert.rejects(result);
  await tick();
  assert.equal(client.server.items.size, 0);
  assert.equal(client.closeCount, 1);
});

test('drains an existing backlog in FIFO order without overlapping operations', async () => {
  const server = new Server(); seed(server, 100);
  const client = new Client(server); const sub = SubQueue({ path: '/queue', client });
  const received = [];
  try {
    for await (const buffer of sub) {
      received.push(buffer.toString());
      if (received.length === 100) break;
    }
  } finally { sub.destroy(); }
  assert.deepEqual(received, Array.from({ length: 100 }, (_, i) => String(i)));
  assert.equal(server.items.size, 0);
  assert.equal(client.maximum, 1);
  assert.ok(client.childReads <= 3, `scanned children ${client.childReads} times`);
});

test('readable demand bounds prefetch and resumes after buffered rows are consumed', async () => {
  const server = new Server(); seed(server, 10);
  const sub = new SubQueue({ path: '/queue', client: new Client(server), highWaterMark: 2 });
  try {
    await once(sub, 'readable'); await tick();
    assert.equal(sub.readableLength, 2);
    assert.equal(server.items.size, 8);
    assert.equal(sub.read().toString(), '0');
    await tick();
    assert.equal(sub.readableLength, 2);
    assert.equal(server.items.size, 7);
  } finally { sub.destroy(); }
});

test('an empty queue wakes when a child is added', async () => {
  const server = new Server(); const sub = new SubQueue({ path: '/queue', client: new Client(server) });
  const delivered = once(sub, 'data');
  await once(sub, 'connect'); await tick();
  const pub = new PubQueue({ path: '/queue', client: new Client(server) });
  pub.end('new');
  assert.equal((await delivered)[0].toString(), 'new');
  sub.destroy(); await finished(pub);
});

test('only exact queue node names are consumed', async () => {
  const server = new Server(); seed(server, 1);
  server.items.set('other-queue-0000000000', Buffer.from('wrong'));
  server.items.set('queue-0000000000-extra', Buffer.from('wrong'));
  const sub = new SubQueue({ path: '/queue', client: new Client(server) });
  assert.equal((await once(sub, 'data'))[0].toString(), '0');
  await tick(); sub.destroy();
  assert.equal(server.items.size, 2);
});

test('competing consumers deliver each successfully deleted node once', async () => {
  const server = new Server(); seed(server, 100);
  const subs = [0, 1].map(() => new SubQueue({ path: '/queue', client: new Client(server) }));
  const seen = [];
  try {
    await new Promise((resolve, reject) => {
      for (const sub of subs) {
        sub.on('error', reject);
        sub.on('data', value => { seen.push(value.toString()); if (seen.length === 100) resolve(); });
      }
    });
  } finally { subs.forEach(sub => sub.destroy()); }
  assert.equal(new Set(seen).size, 100);
  assert.equal(server.items.size, 0);
});

test('read and delete permission errors surface rather than entering a retry loop', async () => {
  for (const method of ['getData', 'remove']) {
    const server = new Server(); seed(server, 1); const client = new Client(server);
    client[method] = (path, callback) => queueMicrotask(() => callback(error('NO_AUTH')));
    const sub = new SubQueue({ path: '/queue', client });
    const rejected = once(sub, 'error'); sub.resume();
    assert.equal((await rejected)[0].name, 'NO_AUTH');
    await tick();
    assert.equal(client.closeCount, 1);
    assert.equal(server.items.size, 1);
  }
});

test('session expiration and delayed callbacks after destroy close once', async () => {
  const client = new Client(); const sub = new SubQueue({ path: '/queue', client });
  await once(sub, 'connect');
  const failed = once(sub, 'error'); client.emit('expired');
  assert.match((await failed)[0].message, /expired/);
  sub.destroy(); await tick();
  assert.equal(client.closeCount, 1);
  assert.equal(client.listenerCount('connected'), 0);
});

test('a stale ready callback after disconnect cannot claim connectivity', async () => {
  const client = new Client(); let ready;
  client.mkdirp = (path, data, acls, mode, callback) => { ready = callback; };
  const pub = new PubQueue({ path: '/queue', client });
  await tick(); client.emit('disconnected'); ready(null); await tick();
  assert.equal(pub.connected, false);
  const reconnect = once(pub, 'connect'); client.emit('connected'); ready(null);
  await reconnect;
  assert.equal(pub.connected, true);
  pub.end(); await finished(pub);
});

test('validates the queue path before connecting', () => {
  for (const path of [undefined, '', 'relative', '/', '/trailing/']) {
    assert.throws(() => new PubQueue({ path }), /path/);
    assert.throws(() => new SubQueue({ path }), /path/);
  }
});


test('configured ACLs apply to both created paths and messages', async () => {
  const client = new Client(); const acls = require('node-zookeeper-client').ACL.CREATOR_ALL_ACL;
  const pub = new PubQueue({ path: '/queue', client, acls });
  pub.end('protected'); await finished(pub);
  assert.equal(client.pathAcls, acls);
  assert.equal(client.itemAcls, acls);
});
