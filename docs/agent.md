# Browser agent

`agent` opens an inline terminal conversation. It uses a browser-only adaptation of Pi's core loop, with an optional OpenAI-compatible Chat Completions transport. No provider SDK or mock replies are bundled.

The terminal system prompt requires direct, concise answers in the user's language, normally 1–3 short sentences. It prohibits follow-up questions, unsolicited options, speculative explanations and search/process narration. Requested articles, code and lists remain complete. Missing information or execution failures are reported as a brief factual limitation.

The model boundary is `StreamFn`. With an encrypted provider configured, the mode opens at a password prompt. Otherwise, until a host injects a stream, the top bar shows “未连接模型接口”, the message draft remains editable, and sending is disabled. Decrypted credentials and conversation live only in memory. Locking or leaving clears the built-in provider connection; reloading also locks it. Exiting clears conversation/queues; workspace file edits remain in IndexedDB.

## DeepSeek / encrypted provider setup

Run in your local interactive terminal (Node 22.18+):

```sh
npm run agent:configure
```

Accept the defaults `https://api.deepseek.com` and `deepseek-flash`, or enter another compatible Base URL and model. The Base URL must include any service prefix such as `/v1`; `/chat/completions` is appended if absent. Enter the API key and a password of at least 8 characters twice. Secret inputs are hidden, excluded from readline history, and never passed as shell arguments. Cancel with Ctrl+C. A successful run atomically replaces `src/agent/provider-config.json` with ciphertext; it never writes a plaintext secret file. The initial value is `null` (unconfigured).

The same configuration can include an optional GitHub token. To add or replace only that token without changing the provider, run `npm run agent:configure -- --github`, enter the existing unlock password and the new token in hidden prompts. The CLI verifies the GitHub account and repository permissions before writing ciphertext. Unlocking then connects GitHub as well as configuring the model. GitHub verification failure does not disable the model; `/github` can reconnect with the same password. Clearing conversation preserves both connections; lock, exit and reload clear them.

Rebuild with `npm run build` and deploy normally. Enter `agent`, type the password, press Enter, then send a message. Unlocking decrypts locally and makes no model request; READY means the adapter is configured, not that the provider has verified the key. Wrong passwords do not make network requests. The password field is separate from chat/history, clears after submission and has no outer border. Tab / Shift+Tab cycle the password and available controls; Esc returns. The footer's lock control is keyboard reachable using Tab + Enter. Locking cancels active work and queued messages; it retains the visible transcript until you clear it or exit.

The envelope uses AES-256-GCM with a random 12-byte IV, a random 16-byte salt, PBKDF2-SHA256 (600,000 iterations), and versioned authenticated additional data. Address, model and key are encrypted together. Only ciphertext is bundled. Passwords and decrypted keys are not written to localStorage, sessionStorage, IndexedDB, chat transcripts or logs. JavaScript cannot guarantee memory zeroization; locking releases references and cancels requests rather than erasing browser internals. Someone who knows the password can retrieve the decrypted key through browser developer tools. Public ciphertext permits offline password guessing, so use a long unique passphrase. This is credential unlocking, not server-side user authorization. If users must never obtain the key, use an authenticated backend.

The page requires HTTPS (localhost is allowed). The provider must support browser CORS for POST and Authorization / Content-Type; the client omits cookies, rejects redirects and avoids displaying server error bodies that could echo secrets. DeepSeek's preflight allowed these headers in a local-origin check on 2026-09-26; verify your deployed origin as well. Setup makes no real model call.

The adapter supports streaming text, reasoning, function tool calls, fragmented SSE/UTF-8, multiple agent turns, and AbortSignal cancellation. It rejects incomplete tool JSON, inconsistent termination, duplicate IDs and unsupported finish reasons before tool execution. It uses Chat Completions, not Responses. For `api.deepseek.com`, it maps effort to `thinking` and `reasoning_effort` and returns **every previous assistant's** `reasoning_content` on requests with tools, including prior answers that made no tool call. Other hosts do not receive DeepSeek-specific fields; their reasoning controls depend on their protocol. Model names are editable in setup.

## Thinking, usage and inference controls

After unlocking DeepSeek, the single-line footer shows token usage on the left and the model, thinking effort and output cap on the right. All agent text uses the terminal font size; there are no body statistics tables or per-reply metadata rows. On narrow screens, scroll the footer horizontally or use Tab to bring its controls into view. Click an effort/cap control or focus it with Tab and press Enter to cycle. The default is **high thinking, 8192 output tokens per model request**. Available effort levels are off, low, high and max; cap presets are 2048 / 8192 / 16384 / 32768 / 65536. `/limit` accepts any integer from 256 to 65536. The cap includes reasoning and answer tokens; a multi-tool task can make several capped requests, up to the core's 32-turn bound. It is not a whole-task spending limit. Preferences persist locally and contain no credentials. Controls are disabled during a task, and slash changes are rejected while running; a task's settings remain fixed through tools and follow-ups.

Reasoning arrives from the provider's `reasoning_content`, renders as separate streaming text, and can be collapsed with its summary (Tab + Enter / Space). Finished reasoning starts collapsed. The final answer remains separate. The top bar distinguishes WAITING, THINKING, RESPONDING, TOOL CALL and TOOLS with elapsed task time. The footer’s latest-request view includes elapsed time and time to first content/reasoning/tool delta. Aborting preserves received reasoning, reported usage and timing, while excluding the failed assistant message from future model context.

Usage stays in the footer. Click the usage-view label or run `/usage` to cycle session, task and latest-request views; `/usage session`, `/usage run` and `/usage last` select one directly. `↑` is input, `↓` output, `Σ` total, `R` cached input and `T` reasoning. Hovering the usage label gives exact counts (including cache misses); the latest-request view also shows duration and first-response time. Counts use compact k/M notation, while an unknown report shows “—” and a known subtotal shows “+”. Reasoning is already included in output; cached input is already included in input. Repeated usage snapshots replace prior values, rather than adding twice. Session input sums each request’s full prompt, including repeated context. No cost or context-capacity estimate is fabricated. Clear resets transcript and counters; locking retains them until clear/exit. No conversation or reasoning is persisted. The footer keeps Tab / Shift+Tab and Esc visible, with a clickable stop/return action. `/help` opens ordinary terminal text with the complete command and key reference.

Local commands (not sent to the provider):

| Command | Action |
| --- | --- |
| `/help` | Toggle command/keyboard help; includes a restore-defaults button |
| `/plugins` | Toggle the installed Python/blog/GitHub plugin and tool list |
| `/github` | Show GitHub connection or reconnect with the shared unlock password |
| `/think off\|low\|high\|max` | Change DeepSeek thinking effort (`none` also means off) |
| `/limit 8192` | Change per-request output-token cap |
| `/usage [session\|run\|last]` | Cycle or select the footer usage view |
| `/clear` | Clear idle conversation and counters |
| `/stop` | Cancel running work and queued messages |
| `/lock` | Lock the password-protected provider |
| `/exit` | Return to the terminal |

Prefix text with `//` to send a literal leading slash to the model. IME composition does not invoke commands. All footer controls and reasoning/tool summaries participate in the mode's bidirectional Tab cycle; no new browser-wide shortcuts are registered.

For programmatic adapters, `StreamFn` accepts optional `inference: { reasoningEffort, maxOutputTokens }` beside `signal`. The browser captures it per task; standalone callers can set it per request. `createOpenAICompatibleStream` retains non-thinking behavior when no effort is passed. `AssistantMessage` now optionally includes `reasoning`, normalized `usage`, `timing`, `model` and the applied `inference`. Stream events additionally include `reasoning_delta` and `usage`. Generic injected streams may omit all metadata. Programmatic callers should use provider-supported effort values; the terminal exposes effort controls only for the official DeepSeek host.

Rotate the key or change the password by rerunning setup and rebuilding. Old deployed ciphertext cannot be recalled; revoke the old key at the provider if it should no longer work.

Protocol references: [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/), [OpenAI Chat Completions streaming](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).

## Connect the model boundary

From application integration code:

```ts
import { configureAgent, type StreamFn } from './src/agent/index.ts'

// Implement this boundary in the host. It can speak to a service or a local model.
const streamFn: StreamFn = (context, { signal }) => hostModelStream(context, signal)
configureAgent({ streamFn })

// Disconnect later:
configureAgent({})
```

`context` contains `systemPrompt`, `messages` and tool declarations (`name`, `description`, JSON `parameters`). Executable functions are never sent to the model. An active run captures the connection when it starts; changing configuration applies to the next run.

The returned async iterable emits:

- `{ type: 'start', partial }` (optional).
- `{ type: 'text_delta', delta, partial }` or `{ type: 'toolcall_delta', partial }`. `partial` is the complete assistant snapshot so far.
- Exactly one final `{ type: 'done', message }`, or `{ type: 'error', error: assistantMessage }`.

Assistant messages have `role: 'assistant'`, `timestamp`, `content`, and `stopReason`. Content blocks are `{ type: 'text', text }` or `{ type: 'toolCall', id, name, arguments }`. Stop reasons are `stop`, `toolUse`, `length`, `error`, `aborted`. Tool IDs must be nonempty and unique within a response. Tools execute only after the completed message; unfinished JSON in deltas is never executed. A `length` response fails its tool calls so the model can reissue them.

No `done`/`error` event, a thrown stream exception, or an invalid message produces an error result and settles the run. Adapters should honor `AbortSignal` and close resources when their iterator returns. The loop stops waiting promptly even for a noncooperative producer, but JavaScript cannot undo side effects in an injected callback that ignores cancellation.

## Core API

```ts
import { Agent, createWorkspaceTools } from './src/agent/index.ts'

const agent = new Agent({
  streamFn,
  systemPrompt: 'Work inside /workspace.',
  tools: createWorkspaceTools(workspace, '/workspace'),
  maxTurns: 32,
})
const unsubscribe = agent.subscribe(async event => {
  // Awaited before subsequent tool/model phases.
})
await agent.prompt('Read README.md and summarize it.')
agent.steer('Focus on installation.') // injected after the active tool batch
agent.followUp('Then update notes.txt.') // injected after a natural stop
agent.abort()
await agent.waitForIdle()
unsubscribe()
```

`agent.state` returns a detached snapshot. `prompt()` rejects concurrent runs; use `steer()` or `followUp()`. Queues drain one message at a time, steering first. `continue()` handles a queued request or an existing user/tool-result/error tail; a successful assistant tail without a queued request requires a new prompt. `reset()` is allowed only when idle. If a turn limit is reached, already-drained queued input is committed to the transcript (not discarded); `continue()` can resume it. Event observers should settle promptly and must not throw; a failing observer rejects the run rather than silently continuing side effects.

Low-level `runAgentLoop` and `runAgentLoopContinue` accept an awaited event sink. `agentLoop` / `agentLoopContinue` expose an async event iterable and `.result()`. Low-level streams are observational, like Pi's streams: consuming events does not gate the producer. Breaking iteration aborts subsequent work. The returned run result contains only messages added in that invocation and an end reason (`stop`, `error`, `aborted`, `max_turns`).

Events include agent/turn start/end, message start/update/end, and tool execution start/update/end. `transformContext` runs before `convertToLlm`; default conversion omits custom UI messages and error/aborted assistant messages. Committed transcript snapshots are not pruned by either hook. `beforeToolCall` can block a validated call; `afterToolCall` can replace its result. Tools are sequential. Progress updates settle before tool completion, and late updates after completion/abort are ignored.

## Workspace tools

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `list_files` | `path` | Immediate children, up to 200 entries; reports truncation |
| `read_file` | `path` | First 32,000 characters; reports total length and truncation |
| `write_file` | `path`, `content` | Create or replace text, up to 2 MB; parent must exist |
| `edit_file` | `path`, `oldText`, `newText` | Exactly one match; rejects stale file content |

All paths resolve against the directory captured when entering `agent`, and stay inside `/workspace`. These tools access the app's IndexedDB filesystem, not the computer's files. `writeFile()` validates and commits in one IndexedDB transaction; abort cancels an uncommitted transaction. An already committed write is not rolled back. `edit_file` passes the original content into the write transaction for an atomic conflict check; `expectedContent: null` requires the target to be absent.

## Python and blog plugins

The terminal registers three built-in plugins alongside the four workspace tools. `/plugins` lists their tools. `run_python` executes code in a dedicated, lazily loaded Pyodide worker, captures stdout/stderr, and saves successful text-file changes with an atomic workspace conflict check. It supports a 1–120 second timeout (default 60) and hard worker termination on cancellation. This interpreter is separate from the terminal's Python REPL. Clear, lock and exit dispose of it; ordinary successful calls retain Python globals. Python can use the browser's JS/network APIs; it is not a security sandbox or a host OS shell.

The blog plugin provides `blog_list`, `blog_read`, `blog_write_draft` and `blog_preview`. It reads the build-time public blog catalog, stores drafts in `/workspace/blog-drafts`, writes the existing YAML metadata format, and checks SHA-256 revisions before replacing drafts. Previews render in the conversation at terminal font size and include a user-activated Markdown download link. Existing Tab / Shift+Tab navigation includes this link and the preview summary; Enter activates the download, Enter / Space toggles the summary, Esc stops or returns. The footer stays unchanged.

Drafts are local IndexedDB files and persist across sessions. Downloading does not publish; move the file into the source repository's `blog/` and use its existing build/deploy process. Published articles are read-only to this plugin. See [agent-plugins.md](agent-plugins.md) for tool parameters, limits and the extension API. The GitHub plugin can commit drafts and delete articles after browser confirmation; Pages builds each push. The build and automated tests have passed.

## Terminal controls

| Key | Action |
| --- | --- |
| Enter | Send; while running, queue a steering message |
| Shift+Enter | New line |
| Alt+Enter | While running, queue a follow-up after the current task |
| Tab / Shift+Tab | Cycle input, available buttons, transcript links/tool summaries and footer |
| Esc | Stop a running task; when idle, return to terminal |
| Ctrl+C | Stop while running if no text selection is active |

The footer also has stop, clear and return buttons, plus lock for an unlocked built-in provider. Clear is disabled while running. Leaving aborts the run and clears queued messages. IME composition bypasses shortcuts. New output follows only when the user is near the bottom; exiting restores terminal focus and scroll position.

## Validation and provenance

`npm run test:agent` runs core, workspace, encryption and transport tests using Node's built-in test runner (Node 22.18+ recommended). `npm run build` checks TypeScript and the browser build. Browser checks cover the command, offline mode, password unlock/relock, interrupted unlock, mocked HTTP streaming with real IndexedDB tools, interruption, queues, keyboard focus, IME, scroll retention and mobile layout. Tests use dummy credentials and make no paid provider calls.

Upstream pin, scope differences and MIT attribution are in [third-party/pi-agent-core/README.md](../third-party/pi-agent-core/README.md). This is not the full Pi coding-agent package and does not claim provider or SDK compatibility.
