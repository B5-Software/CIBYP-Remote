const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  RemoteService,
  Operations,
  EventLog,
  ToolRegistry,
  RemoteError,
  publicValue,
  DeviceGateway,
} = require("../src");
const principal = { id: "client", scopes: ["*"] };
const rpc = (method, params = {}, id = "request") => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
test("WebSocket frames support ws 7/8 types with UTF-8 byte bounds", () => {
  const { decodeFrame } = require("../src/frame");
  const data = JSON.stringify({ label: "你好" }),
    buffer = Buffer.from(data);
  for (const frame of [
    data,
    buffer,
    [buffer.subarray(0, 4), buffer.subarray(4)],
    new Uint8Array(buffer),
  ])
    assert.deepEqual(decodeFrame(frame, buffer.length), { label: "你好" });
  for (const frame of [data, buffer, [buffer]])
    assert.throws(
      () => decodeFrame(frame, buffer.length - 1),
      (error) => error.data.reason === "PAYLOAD_TOO_LARGE",
    );
  assert.throws(() => decodeFrame(Buffer.from([0xc3, 0x28]), 10));
  assert.throws(() => decodeFrame({ length: 1 }, 10));
});
test("write deduplication survives restart, payload reuse is rejected", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ops.json");
  let count = 0;
  const a = new RemoteService({ operationsFile: file });
  a.register("write", "write", async () => ++count, { write: true });
  const results = await Promise.all([
    a.handle(rpc("write", { operationId: "one" }), principal),
    a.handle(rpc("write", { operationId: "one" }), principal),
  ]);
  assert.equal(count, 1);
  assert.deepEqual(results[0], results[1]);
  const b = new RemoteService({ operationsFile: file });
  b.register("write", "write", () => ++count, { write: true });
  assert.equal(
    (await b.handle(rpc("write", { operationId: "one" }), principal)).result,
    1,
  );
  assert.equal(
    (
      await b.handle(
        rpc("write", { operationId: "one", different: true }),
        principal,
      )
    ).error.data.reason,
    "REVISION_CONFLICT",
  );
});
test("interrupted operation becomes unknown and cannot be repeated", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ops.json"),
    a = new Operations(file);
  let finish;
  const pending = a.run(
    "p",
    "id",
    "write",
    {},
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await new Promise((r) => setImmediate(r));
  const b = new Operations(file);
  await assert.rejects(
    b.run("p", "id", "write", {}, () => assert.fail()),
    (e) => e.data.reason === "RESULT_UNKNOWN",
  );
  finish(1);
  await pending;
});
test("permission checks happen before journal lookup; DTOs omit secrets", async () => {
  const service = new RemoteService();
  service.register("settings", "settings.read", () => ({
    llm: { apiKey: "hidden", model: "visible" },
    workingMessages: ["hidden"],
  }));
  assert.equal(
    (await service.handle(rpc("settings"), { id: "reader", scopes: [] })).error
      .data.reason,
    "FORBIDDEN",
  );
  assert.deepEqual((await service.handle(rpc("settings"), principal)).result, {
    llm: { model: "visible" },
  });
  assert.deepEqual(
    publicValue({ refreshToken: "x", nested: { encrypted_content: "y" } }),
    {
      nested: {},
    },
  );
});
test("invalid IDs, notifications, batches and prototype keys fail closed", async () => {
  const service = new RemoteService();
  for (const body of [
    { jsonrpc: "2.0", method: "system.hello" },
    [],
    rpc("system.hello", JSON.parse('{"__proto__":{}}')),
    rpc("system.hello", {}, 1),
  ])
    assert.ok((await service.handle(body, principal)).error);
});
test("event gap/boot requires resync; bounded ring can replay exact cursor", () => {
  const events = new EventLog({ maximum: 2 });
  const old = events.cursor();
  events.publish("one", {});
  const cursor = events.cursor();
  events.publish("two", {});
  events.publish("three", {});
  assert.throws(() => events.replay(old));
  assert.deepEqual(
    events.replay(cursor).map((e) => e.channel),
    ["two", "three"],
  );
  assert.throws(() => events.replay({ streamId: "wrong", sequence: 0 }));
});
test("tools enforce schema, grants, owner and fencing; hung action reports unknown", async () => {
  const tools = new ToolRegistry();
  let writes = 0;
  tools.register(
    {
      name: "gpio",
      inputSchema: {
        type: "object",
        properties: {
          resource: { type: "string" },
          value: { type: "integer", minimum: 0, maximum: 1 },
        },
        required: ["resource", "value"],
      },
      execution: { requiresLease: true },
    },
    () => ++writes,
    { allow: (input) => input.resource === "gpio:17" },
  );
  const lease = tools.acquire("gpio:17", principal, 1000),
    input = { resource: "gpio:17", value: 1 };
  assert.equal(
    await tools.invoke(
      { name: "gpio", operationId: "one", input, ...lease },
      principal,
    ),
    1,
  );
  await assert.rejects(
    tools.invoke(
      {
        name: "gpio",
        operationId: "two",
        input: { ...input, value: 2 },
        ...lease,
      },
      principal,
    ),
  );
  assert.throws(() => tools.acquire("gpio:17", { id: "other" }, 1000));
  tools.acquire("gpio:17", principal, 1000);
  await assert.rejects(
    tools.invoke(
      { name: "gpio", operationId: "three", input, ...lease },
      principal,
    ),
  );
  assert.equal(writes, 1);
  tools.register(
    { name: "hung", inputSchema: { type: "object", properties: {} } },
    () => new Promise(() => {}),
  );
  await assert.rejects(
    tools.invoke(
      { name: "hung", operationId: "four", remainingMs: 5 },
      principal,
    ),
    (e) => e.data.reason === "RESULT_UNKNOWN",
  );
});
test("device credentials are hashed, revocable and reconnect replaces registrations", async () => {
  const { EventEmitter } = require("node:events");
  class Socket extends EventEmitter {
    readyState = 1;
    send() {}
    close() {
      this.closed = true;
    }
    ping() {}
    terminate() {
      this.emit("close");
    }
  }
  const tools = new ToolRegistry(),
    gateway = new DeviceGateway({ tools, bootId: "gateway" });
  const { deviceToken } = gateway.provision({
    deviceId: "board",
    policy: { tools: { read: { resources: ["gpio:1"] } } },
  });
  assert.ok(!JSON.stringify(gateway.list()).includes(deviceToken));
  const hello = Buffer.from(
    JSON.stringify(
      rpc("device.hello", {
        deviceId: "board",
        bootId: "boot",
        tools: [
          {
            name: "read",
            inputSchema: {
              type: "object",
              properties: { resource: { type: "string" } },
            },
          },
        ],
      }),
    ),
  );
  const a = new Socket();
  gateway.accept(a, deviceToken);
  a.emit("message", hello);
  const b = new Socket();
  gateway.accept(b, deviceToken);
  b.emit("message", hello);
  a.emit("close");
  assert.equal(tools.list().total, 1);
  assert.equal(gateway.connections.get("board").socket, b);
  gateway.revoke("board");
  assert.equal(gateway.authenticate(deviceToken), null);
  b.emit("close");
  assert.equal(tools.list().total, 0);
});
test("large tool results remain readable and private; cancellation never claims rollback", async () => {
  const tools = new ToolRegistry(),
    service = new RemoteService();
  tools.attach(service);
  const original = "large 文本".repeat(12000);
  tools.register(
    { name: "large", inputSchema: { type: "object", properties: {} } },
    () => ({
      text: original,
    }),
  );
  const result = (
    await service.handle(
      rpc("tool.invoke", { name: "large", operationId: "large-read" }),
      principal,
    )
  ).result;
  assert.ok(result.resultId);
  assert.throws(
    () => tools.result({ resultId: result.resultId }, { id: "other" }),
    (e) => e.data.reason === "FORBIDDEN",
  );
  let offset = 0,
    json = "";
  do {
    const chunk = tools.result(
      { resultId: result.resultId, offset },
      principal,
    );
    json += chunk.text;
    offset = chunk.nextOffset;
  } while (offset !== null);
  assert.equal(JSON.parse(json).text, original);
  assert.throws(() =>
    tools.register(
      {
        name: "bad",
        inputSchema: { type: "object", properties: { x: { type: "unknown" } } },
      },
      () => {},
    ),
  );
  tools.register(
    { name: "hang", inputSchema: { type: "object", properties: {} } },
    () => new Promise(() => {}),
  );
  const pending = service.handle(
    rpc("tool.invoke", { name: "hang", operationId: "cancel-me" }),
    principal,
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(
    tools.cancel({ targetOperationId: "cancel-me" }, principal).cancelRequested,
    true,
  );
  assert.equal((await pending).error.data.reason, "RESULT_UNKNOWN");
  assert.equal(
    service.operations.get(principal.id, "cancel-me").state,
    "unknown",
  );
});
