# Pi agent core attribution

The control flow and event lifecycle in `src/agent/agent-loop.ts`, and the queue/state wrapper in `src/agent/agent.ts`, are adapted from the MIT-licensed Pi project by Mario Zechner.

- Upstream: https://github.com/badlogic/pi-mono (redirects to the current Pi repository)
- Pinned revision: `d6af72e1857cfb10b41d8ff8e69f0d72b4cf6d31`
- Source: https://github.com/badlogic/pi-mono/blob/d6af72e1857cfb10b41d8ff8e69f0d72b4cf6d31/packages/agent/src/agent-loop.ts
- Related source: `packages/agent/src/agent.ts`, `packages/agent/src/types.ts`
- Original copyright and license: [LICENSE](LICENSE)

This is a browser-focused adaptation, not a drop-in implementation of the entire Pi SDK.

Retained: nested tool/steering/follow-up scheduling, prompt/continue, message and tool event lifecycles, async event barriers, context transforms and model-boundary conversion, before/after tool hooks, cancellation and queued messages.

Changed: provider/model/usage/reasoning dependencies are removed. The host must inject `StreamFn`. This port uses text and complete tool-call messages, sequential tool execution, local argument parsers, and a 32-turn default bound. It normalizes thrown/truncated stream failures, pairs skipped tool calls on cancellation, clones event snapshots, and rejects duplicate tool-call IDs before execution.

Not ported from Pi: providers, API key management, CLI/TUI implementation, parallel tool scheduling, dynamic tool-loadout transcript updates, automatic compaction, sessions/branching, extensions, host bash, image content, or cost accounting. The app separately implements encrypted provider setup, a Chat Completions adapter, terminal controls, optional reasoning text and normalized token/timing metadata; these are local extensions, not Pi API compatibility.
