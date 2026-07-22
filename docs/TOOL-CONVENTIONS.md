# Tool conventions (legibility)

Conventions for tools registered in `packages/core/src/tools/` and executed via
`tool-runtime/`. Based on the "tool legibility" practice from
[lopopolo/harness-engineering](https://github.com/lopopolo/harness-engineering)
(discover → select → invoke → interpret → verify): a tool is legible when an
agent can pick it correctly from its name/schema alone, predict its output
shape, and recover from a failure without guessing.

These are conventions, not enforced by the type system today — apply them
when adding or touching a tool.

## Dry-run mode for consequential tools

Any tool that mutates external state (sends a message, calls a paid API,
writes a file outside the workspace, deletes something) should accept an
optional `dryRun?: boolean` parameter. When `true`, the tool validates its
inputs and returns what it *would* do without performing the side effect —
same output shape as a real call, with a `dryRun: true` marker in the result.

```ts
async function execute(input: { dryRun?: boolean; ... }) {
  if (input.dryRun) {
    return { ok: true, dryRun: true, wouldDo: "send WhatsApp message to +54911..." };
  }
  // ... perform the real side effect
}
```

Not every tool needs this — read-only tools (search, get, list) are
side-effect-free already and don't require a dry-run mode.

## Bounded, stable output shapes

- A tool's success shape should not change between calls to the same tool —
  don't sometimes return a string and sometimes an object.
- Truncate large outputs (matches the pattern already used for checkpointed
  tool messages in `agent/run-store.ts`'s `truncateState`: keep the shape,
  cap the content) rather than returning unbounded blobs.
- Prefer a small number of well-typed fields over a free-form `data: any`.

## Stable failure signatures

When a tool fails, prefer returning a structured error over throwing a bare
string, so the agent (and the durable-queue's `failureSignature` on
`JobExecutorResult`, see `gateway/durable-queue.ts`) can distinguish
"retry this" from "don't bother":

```ts
{ code: "RATE_LIMITED", message: "Provider returned 429", hint: "retry after a few seconds" }
{ code: "NOT_FOUND", message: "Worker abc123 not found", hint: "check the worker id, this will not succeed on retry" }
```

`code` should be a stable, greppable string (not the raw exception message) —
it's what `job-executors.ts` classifies via `resilience/retry.ts#isRetryableError`
to decide whether a job gets retried with backoff or fails immediately.
