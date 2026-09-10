# zookeeper-queue

[![CI](https://github.com/jhurliman/node-zookeeper-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/jhurliman/node-zookeeper-queue/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/zookeeper-queue.svg)](https://www.npmjs.com/package/zookeeper-queue)

Use Node.js streams to publish and consume **persistent queue items in
ZooKeeper**. `PubQueue` writes sequential znodes; `SubQueue` reads them in order
and competes with other consumers by deleting each item before delivery.

The interface fits small coordination queues in systems that already run
ZooKeeper. Publishers honor writable backpressure and drain before closing.
Subscribers honor readable demand, serialize their ZooKeeper operations, and
reuse each child-list snapshot instead of rescanning the entire backlog for
every item. Both constructors include TypeScript declarations.

## Install

```sh
npm install zookeeper-queue
```

Requires Node.js 22+ and a reachable ZooKeeper service. CI tests ZooKeeper 3.9.
The client is JavaScript; no native Node addon is required.

## Publish and consume

With ZooKeeper listening on `127.0.0.1:2181`, save this as `example.mjs` and run
`node example.mjs`. Use a fresh path so earlier messages cannot affect the example:

```js
import { PubQueue, SubQueue } from 'zookeeper-queue';
import { finished } from 'node:stream/promises';

const options = { path: `/example-${Date.now()}`, host: '127.0.0.1', port: 2181 };
const publisher = new PubQueue(options);
const subscriber = new SubQueue(options);

const consume = (async () => {
  for await (const message of subscriber) {
    console.log(message.toString()); // hello world
    break; // Leaving the iterator destroys and closes the subscriber.
  }
})();

try {
  publisher.end('hello world');
  await Promise.all([finished(publisher), consume]);
} finally {
  publisher.destroy();
  subscriber.destroy();
}
```

For CommonJS use `const { PubQueue, SubQueue } = require('zookeeper-queue')`.
Both constructors also work without `new`. The queue path and missing parents
are created automatically. The empty path remains after consumption; streams
do not delete the shared queue itself.

## Stream behavior

| Stream | Input/output | Completion |
| --- | --- | --- |
| `PubQueue` | Buffers, strings, or JSON-serializable objects | `end()` finishes buffered writes, then closes the client |
| `SubQueue` | Buffers, including messages originally written as JSON | `destroy()` closes it; an empty queue stays open for future items |

Publisher writes made before the first connection wait for initialization.
`write()` returns the standard backpressure boolean; use `drain` or a stream
pipeline when producing many items. `end(chunk)` preserves its final chunk.
Serialization failures become stream errors.

Use async iteration or normal readable-stream methods to consume messages.
Object-mode `highWaterMark` defaults to 16, so a paused consumer can still have
prefetched messages in its local buffer. Subscribe to `error` when using events,
or handle rejections from async iteration and `finished()`.

A `connect` event means the client is connected and the queue path is ready.
`close` follows stream destruction. Transient disconnects stop subscriber work;
reconnection rechecks the path and resumes demand. Session expiration,
authentication failures, and read/delete errors other than a competing
consumer's `NO_NODE` race destroy the stream with an error. Create a fresh stream
after such a terminal failure.

## Delivery contract

**Deletion is not an acknowledgment of application processing.** A subscriber
removes a znode before pushing its Buffer. A process crash, lost connection during
delete, or destruction after removal can lose that item. There is no redelivery,
acknowledgment API, or exactly-once processing guarantee.

Only the consumer that successfully deletes an item delivers it. One subscriber
processes the oldest available sequential nodes first; multiple consumers can
finish or emit their work in a different order. A failed or retried sequential
publish can have an ambiguous outcome if the server created the node but the
response was lost. Include application-level message IDs where duplicate
publication matters.

Keep the queue directory dedicated to this library. Subscriber snapshots assume
new items append through persistent sequential creation; do not edit or recreate
message nodes manually. Only exact `queue-` names followed by ten decimal digits
are recognized. Queue paths must be rotated before ZooKeeper's signed sequential
counter overflows into negative names. ZooKeeper's znode size and operational
limits also apply; this is not a bulk data transport or a replacement for an
acknowledged message broker.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `path` | Required | Absolute, non-root queue path without a trailing slash |
| `connectionString` | `host:port` | Client connection string; supports an ensemble/chroot |
| `host` / `port` | `127.0.0.1` / `2181` | Single-server connection settings |
| `timeout` | `30000` | ZooKeeper session timeout in milliseconds |
| `delay` | `5000` | Client retry delay in milliseconds |
| `retries` | `12` | Client retry count |
| `highWaterMark` | `16` | Buffered object count for the stream |
| `acls` | `ACL.OPEN_ACL_UNSAFE` | ACLs applied to new queue paths and message nodes |
| `client` | New client | Inject a configured node-zookeeper-client instance |
| `log(level, message)` | No-op | Optional connection logging |

Each stream owns and closes its client, including an injected client. Do not
share one client between streams. For authenticated access, configure an injected
client and pass the appropriate `acls`. ZooKeeper does not inherit parent ACLs:
the default creates world-readable/writable nodes (`OPEN_ACL_UNSAFE`), matching
the client default. Supplied ACLs apply when nodes are created; they do not
rewrite permissions on existing paths.

## Upgrading from 0.1.x

Version 1 requires Node.js 22+ and updates node-zookeeper-client from 0.2 to 1.1.
The PubQueue/SubQueue names and default object-mode interface remain.

`end()` now follows standard writable semantics, including final chunks,
callbacks, and draining. `destroy()` is idempotent and uses standard stream
error/close events. Readable pause/resume use Node's implementation rather than
custom flags. Errors that were previously swallowed in retry loops now terminate
the stream. Nested queue paths are created through `mkdirp()`.

See [CHANGELOG.md](CHANGELOG.md) for fixes and [Delivery contract](#delivery-contract)
for the limits that still apply.

## Development

```sh
npm ci
npm test
npm run test:types
ZK_TEST_PORT=2181 npm run test:integration
```

Unit tests use a deterministic shared-server fixture to check buffering, races,
errors, reconnect callbacks, and FIFO backlog draining. The integration suite
uses a disposable queue on a real ZooKeeper server and tests buffered writes,
watch wakeups, and competing subscribers. GitHub Actions runs both suites on
Node.js 22, 24, and 26 with ZooKeeper 3.9.

## License

[MIT](LICENSE).
