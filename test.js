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
