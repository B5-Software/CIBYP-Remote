# Custom tools

```js
const unregister = host.tools.register(
  {
    name: 'desk_temperature',
    description: 'Read the desk sensor in Celsius',
    inputSchema: {
      type: 'object',
      properties: { resource: { type: 'string', enum: ['desk:sensor'] } },
      required: ['resource'],
      additionalProperties: false,
    },
    execution: { requiresLease: false, timeoutMs: 1000 },
  },
  async (input, { signal }) => {
    signal.throwIfAborted();
    return { celsius: await readSensor(input.resource) };
  },
  { allow: (input) => input.resource === 'desk:sensor' },
);
```

The validator supports bounded object/array/string/number/integer/boolean schemas and enums, rejecting unknown input fields by default. Declare resource names explicitly; do not hand the model unrestricted chip numbers, register addresses, filesystem paths or code upload entrypoints. Tool implementation code is trusted administrator-installed code, not an OS sandbox.

Writes declare `execution.requiresLease: true`. Remote callers acquire `tool.lease` for the resource, then invoke with the returned `leaseId` and `generation`. Only the lease owner can use/release it. Deadlines cannot exceed the remaining lease lifetime. In Desktop/Mini Agent turns a write goes through shared human approval and an automatic lease; read-only Agent sessions reject hardware writes. Delegated subagents receive only explicitly inherited tool names. New registrations are visible on the next model request without restarting a conversation; Minimal mode does not inject them.

Linux GPIO helpers and Micro GPIO HALs must enforce their own safe timeout, initial state, shutdown state and board pin allowlist. JavaScript abort signals cannot interrupt arbitrary blocking native code. Prefer semantic set-state operations; acknowledge uncertain irreversible actions as `RESULT_UNKNOWN`.
