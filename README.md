node-zookeeper-queue
====================

[![Build Status](https://travis-ci.org/jhurliman/node-zookeeper-queue.png)](https://travis-ci.org/jhurliman/node-zookeeper-queue)

FIFO queue using ZooKeeper, implemented with node.js streams

## Download

The source is available for download from
[GitHub](http://github.com/jhurliman/node-zookeeper-queue).
Alternatively, you can install using Node Package Manager (npm):

    npm install zookeeper-queue

## Quick Example

This library exports two different stream constructors, depending on whether
you want publish or subscribe (write or read). Both streams follow the standard
stream interface for Writable or Readable with the addition of a `destroy()`
method on SubQueue to disconnect from ZooKeeper, which is done with the `end()`
method on PubQueue.

```js
var zkQueue = require('./');
var ZKPubQueue = zkQueue.PubQueue; // Inherits from streams.Writable
var ZKSubQueue = zkQueue.SubQueue; // Inherits from streams.Readable

var options = { path: '/myqueue', host: 'localhost', port: 2181 };

var subQueue = ZKSubQueue(options)
  .on('connect', function() {
    console.log('[SUB] Connected');
  })
  .on('data', function(data) {
    console.log('[SUB] Received a message: ' + data.toString());

    pubQueue.end();
    subQueue.destroy();
  })
  .on('close', function() {
    console.log('[SUB] Closed the queue connection');
  });

var pubQueue = new ZKPubQueue(options)
  .on('error', function(err) {
    console.error('[PUB] An error occurred: ' + err);
  })
  .on('connect', function() {
    console.log('[PUB] Connected. Writing "hello world" to the queue');
    pubQueue.write('hello world');
  })
  .on('close', function() {
    console.log('[PUB] Closed the queue connection');
  });
```
