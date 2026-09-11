# Changelog

## 1.0.0 — 2026-09-10

- Require Node.js 22+ and update node-zookeeper-client to 1.1.
- Drain writable buffers and preserve end(chunk) before closing; wait for initial readiness before writing.
- Use standard stream destruction, close/error events, and readable backpressure.
- Serialize subscriber operations, drain existing backlogs, and cache sorted child lists.
- Restrict child names to the exact queue format; retry only missing-node races and surface other failures.
- Ignore stale initialization callbacks after disconnect; terminate on expired sessions/authentication failure.
- Create nested queue paths and support ensemble connection strings.
- Add deterministic race/lifecycle tests, real ZooKeeper CI integration, declarations, package contents, and release documentation.
- Remove Travis and the obsolete Mocha runner; rewrite the README with explicit delivery semantics.

Messages are still removed before application processing. This release does not add acknowledgment, redelivery, or exactly-once guarantees.
