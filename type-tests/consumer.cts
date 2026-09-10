import { PubQueue, SubQueue, type QueueOptions } from '../index.js';
const options: QueueOptions = { path: '/jobs', connectionString: 'localhost:2181', highWaterMark: 4 };
const pub = new PubQueue(options);
const sub = SubQueue(options);
pub.write(Buffer.from('test'));
pub.end('last');
sub.on('data', (buffer: Buffer) => { const message: string = buffer.toString(); });
sub.destroy();
