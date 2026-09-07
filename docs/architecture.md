# Architecture: host / client halves and how they talk

BotTollbooth is a **dynamic Cordis plugin** inside DeepSeek Harness. "Dynamic"
means the plugin's code is a plain-JavaScript function body written at runtime
and mounted through the harness' own Cordis toolset — not a statically packed
npm dependency. The runner that installed and operated it is
`@deepseek-ai/dsh-cordis-host-runner` + `@deepseek-ai/dsh-cordis-client-runner`
(via `@deepseek-ai/dsh-tool-cordis`), all part of the open-source
`@deepseek-ai/dsh-*` profile the session runs on.

## Two halves, one process boundary

```
┌─────────────────────────────┐          ┌──────────────────────────────┐
│  HOST HALF (Node.js)        │          │  CLIENT HALF (Browser)       │
│                             │          │                              │
│  inject: ['botDetection']   │   JSON-   │  inject: ['slots','theme',  │
│  harness.handle('...')      │ ──RPC──▶ │   'host']                    │
│  ctx.on('botDetection/...') │ ◀────────│  host.call('botDetection.  │
│  ctx.effect(...)            │          │   summary', {period})       │
│                             │          │  slots.inject('tool.view.   │
│                             │          │   cordis', ...)             │
└─────────────────────────────┘          └──────────────────────────────┘
```

- The **host half** runs in the DSH host process (Node.js side). It holds the
  in-memory request feed and registers package-private JSON-RPC methods.
- The **client half** runs in the browser page's client-runner world. It has
  **no** `fetch`, no `window`, no `import` — it gets a seat in the UI via
  `ctx.slots`, reads the theme via `ctx.theme`, and talks to the host over the
  harness' JSON-RPC bridge via `ctx.host.call`.
- Session scoping: the host halves scope their feed per `ctx.sessionId`, and
  the `tool.view.cordis` slot is `scope: 'session'`. Nothing leaks across
  sessions.

## Cordis plugin-body shape

Both bodies return a Cordis plugin object:

```js
function myBody() {
  return {
    inject: ['some.service'],   // hard dependency: activation blocks until present
    apply(ctx) {                // ctx is the scoped Cordis context
      // ctx.on / ctx.effect / harness.handle ...
    },
  };
}
```

The constraints are deliberate and enforced by the runner:

- **No TypeScript, no JSX, no imports/exports** inside the body — the body is
  evaluated as plain JS.
- React UI is written with `React.createElement(...)` only.
- Effects must be owned (return a cleanup from `ctx.effect`) so that
  `cordis_stop` / `cordis_run --update` tear down cleanly.

## Slot registration (`tool.view.cordis`)

The Package-owned region rendered inside the latest eligible `cordis_run`
card. Per the shipped slot contract, dynamic client code registers with
`key: 'self'`:

```js
ctx.slots.inject('tool.view.cordis', () =>
  ctx.slots.register(
    { name: 'tool.view.cordis', key: 'self' },
    () => React.createElement('div', null, '…'),
  ),
);
```

The Guard binds `key: 'self'` to the current Plugin+Package, so the business
view always renders for the right package even when several exist.

## Lifecycle (what the README glosses over)

All of it is driven by the model-facing tools `cordis_define`, `cordis_run`,
`cordis_stop`, `cordis_undefine`, `cordis_inspect_*`:

1. `cordis_define` — records an **immutable Package** (`code.host` /
   `code.client`), validates syntax, does **not** execute it.
2. `cordis_run` — activates a Package; an unauthorized client half becomes an
   **approval request**, otherwise activation continues asynchronously.
3. `cordis_stop` / `cordis_undefine` — stop the run, or permanently remove the
   plugin and all its packages.

`currentPackageId` advances only on complete success; failed targets stay as
`nextPackageId` and can be re-run. This is what makes the whole thing
iterable — we shipped `pkg-1` → `pkg-7` across one session without ever
breaking the runtime.