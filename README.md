# CIBYP Remote

Shared Remote v2 contract, JavaScript SDK and gateway implementation for **Could I Be Your Partner**, **CIBYP Mini** and **CIBYP Micro**.

![Checks](https://github.com/B5-Software/CIBYP-Remote/actions/workflows/check.yml/badge.svg)

No npm publication is needed. Desktop vendors a SHA-256 locked copy; Mini consumes the same implementation through its shared Node core. Node 22/24 are tested. The browser-safe client is `src/client.js`; server modules use Node APIs.

```js
const { RemoteClient } = require('./src/client');
const WebSocket = require('ws');
const client = new RemoteClient({
  url: 'http://127.0.0.1:12000',
  token: process.env.CIBYP_REMOTE_TOKEN,
  socketFactory: (url, token) =>
    new WebSocket(url, {
      headers: { Authorization: 'Bearer ' + token },
    }),
  onEvent(event) {
    // On reset, reload snapshots. Never infer success from a lost response.
    console.log(event.type, event.channel || '');
  },
});
await client.connect();
const sessions = await client.call('session.list');
client.close();
```

Browsers use same-origin HttpOnly cookies from `/remote/v2/auth/login`, `new WebSocket(url)` and the existing login/TOTP flow. Native clients use bearer headers. Remote connections require HTTPS/WSS; plain HTTP is restricted to loopback. Transport encryption, including Tor/SSH forwarding, does not replace scoped authentication.

Read [the wire specification](spec/protocol.md), [compatibility and methods](spec/services.md), and [tool extension guide](spec/tools.md). Run `npm test` for persistence, authorization, reconnect, lease, deadline and malformed-message checks.

GPL-3.0-or-later. This is an initial protocol release; real board qualification is separate from software conformance.
