# Remote v2.0

The control profile uses JSON-RPC 2.0 over UTF-8 HTTP. It intentionally supports named parameters, string IDs of 1–160 ASCII identifier characters, and calls requiring replies. Batches, positional parameters and write notifications are rejected. `jsonrpc: "2.0"` identifies JSON-RPC, while `/remote/v2/` identifies CIBYP's protocol major.

| Endpoint                             | Behavior                                                     |
| ------------------------------------ | ------------------------------------------------------------ |
| `GET /.well-known/cibyp-remote`      | Public service/protocol/authentication metadata only         |
| `POST /remote/v2/auth/login`         | Existing password + optional TOTP; rate limited              |
| `POST /remote/v2/auth/logout`        | Revoke the browser session                                   |
| `POST /remote/v2/rpc`                | Authenticated JSON-RPC                                       |
| `WS /remote/v2/events`               | Scope-filtered events and resumable cursor                   |
| `WS /remote/v2/devices`              | Device identity only; ordinary user credentials are rejected |
| `POST /remote/v2/blobs`              | Binary attachment upload, 8 MiB maximum                      |
| `GET /remote/v2/blobs/:attachmentId` | Authorized attachment bytes with SHA-256 header              |

Control limits: 256 KiB per RPC request/response, eight concurrent requests, nesting depth 24. Pagination defaults to 50 items, maximum 100; tool pages maximum 64. `system.hello` reports actual capabilities, limits, product/version, persistent `instanceId`, per-process `bootId`, and event cursor.

Every write requires `params.operationId`. Retrying the same ID and parameters returns the recorded result; changed parameters fail with `REVISION_CONFLICT`. An interrupted in-flight operation becomes `RESULT_UNKNOWN` on restart and is never silently re-executed. The gateway journal is bounded to 512 operations with a 24-hour retention window; clients must generate globally unique IDs and must not retry older actions automatically. Query `operation.get` first after ambiguous delivery. Atomic persistence uses fsync + rename; deployment storage must support these semantics.

New client/device secrets are returned on issuance, kept in memory for same-boot retry, and omitted from the on-disk operation result. Only token hashes are stored in the identity catalog. After a backend restart, issue a new credential if the one-time result was lost; the prior identity remains revocable.

Events have `{type:"event",streamId,sequence,channel,payload}`. Subscribe with query `streamId` + `after`. A restarted stream or expired buffer emits `{type:"reset",reason:"RESYNC_REQUIRED",cursor}`; reload snapshots and resume from the returned cursor. Initial snapshots include their own cursor. Subscribe before loading additional snapshot pages and merge events by sequence. Event buffers are bounded to 512 records / 1 MiB, individual oversize events force resynchronization; slow sockets close with 1013. Session, settings, device and tool events require their respective read scope. WebSocket authentication is rechecked every 15 seconds. Authentication failure closes 1008 and stops SDK reconnection; transient failures use bounded jittered backoff.

Errors contain `code`, safe `message`, and `data.reason`, `retryable`, optional `retryAfterMs` / `operationId`. Codes: 1001 auth, 1003 forbidden, 1004 missing capability, 1009 revision conflict, 1010 busy, 1011 device offline, 1012 deadline, 1013 unknown result, 1014 payload too large, 1015 resync. JSON-RPC -32600/-32601/-32602 apply to invalid calls/methods/parameters. Clients translate stable reasons; internal exception stacks are not sent.

## Device profile

One text message ≤4096 bytes, ≤16 tool descriptors, one in-flight action. Authenticate using the provisioned 64-hex device token, then send `device.hello` with `deviceId`, fresh `bootId`, and tools. The gateway intersects descriptors with its administrator-owned resource policy. Descriptors cannot grant write permissions themselves.

The gateway sends `tool.invoke` containing `name`, `input`, a principal-namespaced `operationId`, `remainingMs`, persistent `gatewayId`, `gatewayBootId`, increasing durable `deviceSequence`, and write `leaseId` / `generation`. Device sequences are persisted before dispatch, including across credential revocation. C devices persist their accepted sequence before an effect and reject old sequences even after detailed results retire. A changed gateway identity requires deliberate local provisioning; it cannot steal an existing binding. The Micro journal retains interrupted/unknown actions and only retires confirmed results. A full unknown-result journal fails closed.

GPIO timers are local. Lost acknowledgement is not proof of failure; cancellation never promises to reverse an already completed effect. Gateway leases cannot provide physical exactly-once semantics. Telemetry `{type:"telemetry",payload:{...}}` is coalesced to ≤1 Hz, separate from action replies. Gateway ping/pong detects offline devices; no device receives settings, chat history or model credentials.

See [JSON-RPC](https://www.jsonrpc.org/specification) and the executable schemas/tests in this repository.
