# API contracts (as shipped by `@deepseek-ai/dsh-tool-cordis`)

These are the exact input schemas that drive the dynamic-plugin workflow.
They are reproduced here (trimmed to the essential fields) so a reader can
submit BotTollbooth into any DSH profile without re-discovering the contract.
Schema source: `dsh-tool-cordis`, `tool-cordis` package bundles.

## `cordis_define` — record an immutable Package

| Field | Type | Requirement |
| --- | --- | --- |
| `plugin` | object | one of: `{ kind: 'new', idPrefix: string }` or `{ kind: 'existing', pluginId: string }` |
| `name` | string | short readable Package name |
| `purpose` | string | one-sentence user-facing description |
| `code` | object | `{ host?: string, client?: string }` — at least one required |

`code.host` / `code.client` are **plain-JS function bodies that return a
Cordis plugin**. No TypeScript, JSX, or import transformation occurs. Define
only validates syntax and records source — it does **not** request approval,
execute `apply`, or change `currentPackageId`. On success it returns
`{ pluginId, packageId, name, purpose, hasHostHalf, hasClientHalf }`.

## `cordis_run` — activate one exact Package

| Field | Type | Requirement |
| --- | --- | --- |
| `pluginId` | string | Plugin ID returned by `cordis_define` |
| `packageId` | string | immutable Package ID to activate |
| `mode` | `'run' \| 'update'` | `run` for first activation / restart / rollback; `update` to switch current→target |

An unauthorized client half returns `awaiting-approval`; an authorized one
returns `starting` and continues asynchronously. `currentPackageId` changes
only after complete success. On failure, old current + target next remain;
read diagnostics via `cordis_inspect_self`, correct the same plugin, retry.

## `cordis_stop` — disable effects, keep versions

| Field | Type |
| --- | --- |
| `pluginId` | string |

Stops the current run and cancels unfinished approval/activation. Retains the
plugin, every immutable package, grants, `currentPackageId` and
`nextPackageId` — so the plugin can be re-run directly. Idempotent.

## `cordis_undefine` — permanent removal

| Field | Type |
| --- | --- |
| `pluginId` | string |

Removes the plugin and all packages after stopping it. Returns
`{ pluginId, wasRunning }`.

## `cordis_inspect_list` / `cordis_inspect_query` / `cordis_inspect_self`

- `inspect_list` — enumerate available Services / Events / Slots / plugins.
- `inspect_query` — read the exact contract of one service/event/slot before
  depending on it.
- `inspect_self` — live state of one plugin/package: `provides`, `waitingFor`,
  package list, current/next pointers, client load report.

## Host service dependencies BotTollbooth declares

```js
// Host half
inject: ['botDetection']                       // hard dependency; blocks until live
// Client half
inject: ['slots', 'theme', 'host']             // UI seats + JSON-RPC bridge
```

### `slots` face used here

- `ctx.slots.inject(slot, () => ctx.slots.register(spec, render))`
- `ctx.slots.register({ name, key }, component)`

### `tool.view.cordis` slot declaration (shipped)

```ts
'tool.view.cordis': {
  kind: 'keyed';
  scope: 'session';
  owner: { pluginId, packageId, pluginRunId };
}
```

Dynamic client code registers with `key: 'self'`; the Guard binds that key to
the current Plugin+Package.