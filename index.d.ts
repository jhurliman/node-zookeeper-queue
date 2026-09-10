/// <reference types="node" />
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
export interface ZooKeeperClient extends EventEmitter {
  connect(): void;
  close(): void;
  mkdirp(path: string, data: null, acls: ZooKeeperACL[], mode: number, callback: (error: Error | null) => void): void;
  create(path: string, data: Buffer, acls: ZooKeeperACL[], mode: number, callback: (error: Error | null, path?: string) => void): void;
  getChildren(path: string, callback: (error: Error | null, children: string[]) => void): void;
  getChildren(path: string, watcher: (event: unknown) => void, callback: (error: Error | null, children: string[]) => void): void;
  getData(path: string, callback: (error: Error | null, data: Buffer) => void): void;
  remove(path: string, callback: (error: Error | null) => void): void;
}
export interface ZooKeeperACL { toRecord(): unknown; }
export interface QueueOptions {
  acls?: ZooKeeperACL[];
  path: string;
  connectionString?: string;
  host?: string;
  port?: number;
  timeout?: number;
  delay?: number;
  retries?: number;
  highWaterMark?: number;
  client?: ZooKeeperClient;
  log?: (level: string, message: string) => void;
}
export interface PubQueue extends Writable {
  readonly path: string;
  readonly connected: boolean;
  readonly ended: boolean;
  readonly zooClient: ZooKeeperClient;
}
export interface SubQueue extends Readable {
  readonly path: string;
  readonly connected: boolean;
  readonly ended: boolean;
  readonly zooClient: ZooKeeperClient;
}
export const PubQueue: { new(options: QueueOptions): PubQueue; (options: QueueOptions): PubQueue };
export const SubQueue: { new(options: QueueOptions): SubQueue; (options: QueueOptions): SubQueue };
