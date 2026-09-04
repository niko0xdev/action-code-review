---
name: nodejs
description: Node.js (v20+) backend code review covering async patterns, streams, error handling, resource management, and runtime safety. Use when reviewing Node.js server code (Express, Fastify, raw http, workers, scripts).
---

# Node.js Code Review

When reviewing Node.js server code, prioritize:

## Async Patterns

- **await or return**: every async function path must either await or return the promise. Missing await = unhandled rejection.
- **Promise.all for parallel**: independent operations → `Promise.all([fetch(url1), fetch(url2)])`. Sequential awaits when not needed = N× latency.
- **Promise.allSettled vs all**: use `allSettled` when you want to process partial successes (one failed, others OK). `all` short-circuits on first rejection.
- **No async in forEach**: `arr.forEach(async () => ...)` doesn't await — use `for...of` or `Promise.all(arr.map(async ...))`.
- **Floating promises**: TypeScript strict mode flags these with `no-floating-promises`. Add `await` or `.catch()`.

## Error Handling

- **Always handle rejection**: unhandled promise rejections crash Node.js v15+ (`unhandledRejection` policy).
- **Try/catch vs catch on chain**: `.catch()` on promise chains is fine; `try/catch` for async/await.
- **Don't swallow**: `catch (e) { /* ignore */ }` — log at minimum. Silent failures are debugging nightmares.
- **Operational vs programmer errors**: distinguish (`Error` for programmer, custom for user input). Treat user input as recoverable.
- **Don't throw strings**: `throw "oops"` loses stack trace. `throw new Error("oops")` preserves it.

## Streams & Backpressure

- **Pipelines for memory**: `fs.createReadStream('big.csv').pipe(parser).pipe(filter)` — never `fs.readFileSync('big.csv')` (loads entire file).
- **Backpressure**: when `write()` returns `false`, pause and wait for `drain` event before resuming. Don't ignore backpressure or memory explodes.
- **Object mode**: streams of objects (not buffers) need `{ objectMode: true }`. Mixing modes crashes silently.
- **Stream cleanup**: always handle `error`, `end`, `close` events. Unclosed streams leak file descriptors.

## Resource Management

- **Always cleanup**: timers (`clearInterval`), handles (`fileHandle.close()`), connections (`socket.destroy()`). Use `try/finally` or `using` syntax (TC39 Stage 3).
- **Connection pools**: `pg.Pool`, `http.Agent`, `redis.createClient` — call `.end()` on shutdown.
- **Memory leaks**: closures holding large objects, event listeners never removed, growing arrays in long-lived scopes.
- **Heap snapshots**: for diagnosis, use `v8.writeHeapSnapshot()` then load in Chrome DevTools.

## Event Loop & Concurrency

- **Worker threads for CPU-bound**: crypto, image processing, large data transforms. Main thread is single-threaded — long sync work blocks all I/O.
- **`cluster` for multi-core**: scale beyond single process. Use `cluster.fork()` + shared port via `server.listen({ reusePort: true })`.
- **Don't block event loop**: sync file I/O, sync crypto, large JSON.parse on hot paths → freeze server. Use async APIs or workers.
- **`process.nextTick` vs `setImmediate`**: `nextTick` runs before I/O callbacks (can starve I/O); `setImmediate` runs on next event loop iteration. Default to `setImmediate` unless you specifically need priority.

## HTTP Servers

- **Body size limits**: `express.json({ limit: '100kb' })` — unlimited body is DoS vulnerability.
- **Timeouts**: `server.headersTimeout`, `keepAliveTimeout`, `requestTimeout`. Default Node.js has no request timeout — set explicitly.
- **Graceful shutdown**: handle `SIGTERM`/`SIGINT`, stop accepting new connections, drain in-flight, close DB pool. Otherwise K8s rolling restarts lose requests.
- **CORS**: don't use `cors()` with `origin: '*'` for credentialed requests (browsers block). Whitelist specific origins.

## Security

- **Never eval**: `eval()`, `Function()` constructor, `vm.runInThisContext()` with user input = RCE.
- **Path traversal**: `path.join(baseDir, userInput)` — if `userInput = '../../etc/passwd'`, escapes. Validate resolved path is under baseDir.
- **SQL injection**: never string concat. Use parameterized queries (`pg.query('... $1', [val])`).
- **Prototype pollution**: `Object.assign(target, JSON.parse(input))` — if input has `__proto__`, pollutes Object prototype. Sanitize keys.
- **Crypto**: use `crypto.randomBytes(32)` for tokens, never `Math.random()`. Use `crypto.timingSafeEqual` for comparison.

## Performance

- **Streaming responses**: `res.write(chunk)` incrementally. `res.send(bigArray)` loads entire array in memory.
- **Compression**: `compression()` middleware for text responses. ~70% size reduction.
- **Caching**: `Cache-Control` headers + `ETag` for client-side caching. Server-side: Redis for shared state.
- **Database indexes**: check `EXPLAIN ANALYZE` for slow queries. Missing index on `WHERE` columns = full table scan.
- **Connection pooling**: `pg.Pool({ max: 10 })` not `new Client()` per request.

## Common Issues to Flag

- `await` in `forEach` (silent no-op).
- Unhandled promise rejection (will crash Node.js).
- `fs.readFileSync` on large files (memory exhaustion).
- No body size limit on POST endpoints.
- Sync work in async handlers (blocks event loop).
- Hardcoded secrets in env vars at module load time (use runtime config).
- Missing `Content-Security-Policy` headers.
