'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');
const { PubQueue, SubQueue } = require('..');
const zookeeper = require('node-zookeeper-client');
if (!process.env.ZK_TEST_PORT) throw Error('Set ZK_TEST_PORT to a disposable ZooKeeper server port');
const connectionString = `127.0.0.1:${process.env.ZK_TEST_PORT}`;
const path = `/queue-test-${process.pid}-${Date.now()}`;

test('real ZooKeeper: buffered publication, FIFO backlog, watch wakeup and competing subscribers', { timeout: 30000 }, async () => {
  const options = { path, connectionString, delay: 100, retries: 3 };
  const pub = new PubQueue(options);
  const subs = [];
  try {
    for (let i = 0; i < 100; i++) pub.write(String(i));
    pub.end(); await finished(pub);
    const first = new SubQueue({ ...options, highWaterMark: 1 }); subs.push(first);
    const received = [];
    for await (const value of first) {
      received.push(value.toString());
      if (received.length === 100) break;
    }
    assert.deepEqual(received, Array.from({ length: 100 }, (_, i) => String(i)));
    const shared = [new SubQueue(options), new SubQueue(options)]; subs.push(...shared);
    const seen = [];
    const delivered = new Promise((resolve, reject) => {
      for (const sub of shared) {
        sub.on('error', reject);
        sub.on('data', data => { seen.push(data.toString()); if (seen.length === 100) resolve(); });
      }
    });
    await Promise.all(shared.map(sub => once(sub, 'connect')));
    const second = new PubQueue(options);
    for (let i = 100; i < 200; i++) second.write(String(i));
    second.end(); await finished(second); await delivered;
    assert.equal(new Set(seen).size, 100);
    assert.deepEqual(seen.map(Number).sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i + 100));
  } finally {
    pub.destroy(); subs.forEach(sub => sub.destroy());
    const cleanup = zookeeper.createClient(connectionString);
    const connected = once(cleanup, 'connected'); cleanup.connect(); await connected;
    try { await new Promise((resolve, reject) => cleanup.remove(path, error => error ? reject(error) : resolve())); }
    finally { cleanup.close(); }
  }
});
