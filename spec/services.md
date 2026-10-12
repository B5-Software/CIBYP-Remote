# Services and compatibility

| Methods                                                                                        | Required scope                                              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `system.hello`, `system.health`, `operation.get`                                               | `system.read`                                               |
| `system.stop` (Mini)                                                                           | `system.manage`                                             |
| `session.list/get/messages`, `history.list`, `todo.get`                                        | `sessions.read`                                             |
| `session.create/initialize/submit/title/stop/undo/close`, `history.open/delete`, `todo.toggle` | `sessions.write`                                            |
| `interaction.answer`                                                                           | `interactions.answer`                                       |
| `settings.catalog/get`                                                                         | `settings.read`                                             |
| `settings.patch`                                                                               | `settings.write`                                            |
| `settings.privatePatch`                                                                        | `secrets.write` (manual account/configuration clients only) |
| `workspace.list/bind`                                                                          | `workspace.read` / `workspace.write`                        |
| `attachment.list/get`, blob download                                                           | `files.read`                                                |
| blob upload                                                                                    | `files.write`                                               |
| `tool.list`                                                                                    | `tools.read`                                                |
| `tool.invoke/lease/release`                                                                    | `tools.invoke`                                              |
| `device.list`                                                                                  | `devices.read`                                              |
| `device.provision/revoke/setPolicy`                                                            | `devices.manage`                                            |
| `client.list/issue/revoke`                                                                     | `clients.manage`                                            |

Methods implemented by the desktop integration are in `src/main/services/remote-control.js` in the desktop repository. `settings.patch` uses `expectedRevision`; concurrent edits fail rather than overwrite. Ordinary reads omit secret fields and provider reasoning ciphertext. A manual credential write is a separate permission and never returns secrets. Session message attachments use server-issued attachment IDs, not arbitrary client file paths. Blob upload query parameters: `sessionId`, `name`, `type`, `sha256`, `operationId`; body is `application/octet-stream`. Verify the hash before sending and on download.

Questions and approvals include independent interaction ID and revision. `interaction.answer` must match the current pair; a stale answer cannot approve a later question. Long LLM turns return accepted promptly via `session.submit`; follow normalized Agent events and load persisted history after reconnect.

The existing `/api/*` v1 API remains for GUI, TUI, WebUI, Android/Wear OS and IDE clients. It shares the same runtime, settings and sessions. V1 owner credentials are broad and intended for trusted application frontends; newly issued v2 scoped credentials **cannot access the v1 IPC bridge**. New device integrations must use v2. V1 retirement is not scheduled before two stable desktop release cycles and client migration.

| Product                  | v1 controller     | v2 controller | v2 device gateway | device node |
| ------------------------ | ----------------- | ------------- | ----------------- | ----------- |
| Desktop with this change | yes               | yes           | yes               | no          |
| Mini 0.1 alpha           | yes, no static UI | yes           | yes               | no          |
| Micro 0.1 alpha          | no                | no            | no                | yes         |

Mini does not pretend desktop windows, VM, cameras, editor/LSP, or graphical file pickers exist. Unsupported host calls return `CAPABILITY_UNAVAILABLE`. Existing clients keep native interfaces; dedicated device controls in every native client are an incremental client feature, not a second Agent backend.

Additional bounded reads and lifecycle calls:

| Method                          | Permission       | Behavior                                                                                                                             |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `session.message`               | `sessions.read`  | `messageIndex`, `offset`, `limit` (1–16384 characters), optional `sha256` guard; returns JSON text chunks, totalChars and nextOffset |
| `tool.describe`                 | `tools.read`     | Returns one named tool's current schema                                                                                              |
| `tool.result`                   | `tools.invoke`   | Reads a large tool result by resultId and offset, scoped to its caller; retained for ten minutes within an 8 MiB instance budget     |
| `tool.cancel`                   | `tools.invoke`   | `targetOperationId` plus its own operationId; requests cancellation and never claims physical rollback                               |
| `update.status`                 | `system.read`    | Host update state                                                                                                                    |
| `update.check/download/install` | `updates.manage` | Mutations require operationId; install additionally requires `confirm: true`. Mini stages verified core and requires service restart |

`session.messages` returns up to ten items per page. Large items contain messageIndex, a preview and `readMethod`; retrieve every character through `session.message`. A changed message returns REVISION_CONFLICT when its hash guard no longer matches. Large tool results return resultId and SHA-256; an expired or restarted result store returns RESYNC_REQUIRED. Neither condition authorizes repeating a hardware action. Both public and private settings patches require expectedRevision; the private method never echoes credential values.
