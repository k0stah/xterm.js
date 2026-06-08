# xterm.js Agent Instructions

## MemPalace-First Memory

Use MemPalace as the primary durable memory store across sessions.

- Canonical memory store: `/Users/kostia/.mempalace/palace`
- Reference mirror: `/Users/kostia/Documents/Obsidian Vault`
- Continuity-only MCP: `memory` server at `/Users/kostia/.codex/memory/knowledge_graph.json`

### Memory Policy

1. MemPalace is the source of truth for durable memory.
2. Obsidian is reference/mirror context and import source unless explicitly promoted.
3. `memory` MCP is a thin pointer layer only:
   - canonical paths
   - active project wing pointers
   - selected stable preferences
4. Do not store detailed durable project history in memory MCP.
5. Never store secrets or credentials in any memory system.
6. Memory processing is local-only; do not use external rerank or summarization APIs.

### Runtime Protocol

At the start of each task:

1. Call `mempalace_status`.
2. Run targeted `mempalace_search` for relevant people, projects, and decisions before making assumptions.
3. Use existing wings and rooms when possible instead of creating new taxonomy ad hoc.

During a task:

1. Query before claiming historical, person, or project facts.
2. Save durable updates via structured drawers with required metadata:
   - `wing`
   - `room`
   - `hall`
   - `source_file`
   - `timestamp`
   - `content_type`
3. Use halls consistently:
   - `hall_facts`
   - `hall_events`
   - `hall_discoveries`
   - `hall_preferences`
   - `hall_advice`
4. Keep entries concise, factual, and traceable to source context.

At checkpoint and task end:

1. Auto-checkpoint every roughly 15 user turns and before compaction.
2. On task end, save a final durable summary to MemPalace.
3. Update KG only when relationships or facts changed over time.

### Taxonomy Conventions

- Project wings: `wing_project_<slug>`
- Person wings: `wing_person_<slug>`
- Session/runtime wings: `wing_codex_sessions`
- Stable topic rooms use slugs such as `auth`, `infra`, or `experiments`.
- Decision rooms are prefixed with `decision-` where applicable.

### Operational Controls

1. Redact secret-like tokens before storing memory.
2. Skip transient/generated sources such as `node_modules`, `.next`, build outputs, and archives.
3. Prefer idempotent writes with deterministic IDs where possible.
4. Keep a retry queue for failed writes and replay it on the next ingest cycle.

## ECC Harness Layer

Use [`affaan-m/ECC`](https://github.com/affaan-m/ECC) as the cross-harness operating layer for Codex work in this repository. ECC is a harness-native agent system for Codex, Claude Code, Cursor, OpenCode, and related tools, with reusable agents, skills, hooks, rules, MCP conventions, and workflow discipline.

### ECC Usage Policy

1. Treat this `AGENTS.md` as the project-local Codex control surface.
2. Apply ECC principles proactively:
   - agent-first delegation for complex work
   - plan before execution for multi-file or high-risk changes
   - test-driven implementation for bug fixes and new behavior when practical
   - security-first review before commits or sensitive changes
   - verification loops using build, lint, unit tests, integration tests, or focused smoke tests
3. Prefer ECC-style role routing using the available Codex skills/tools:
   - planning or architecture work: use planner/architect judgment before editing
   - TypeScript or JavaScript changes: use reviewer mindset after edits
   - tests: use the xterm.js `unit-test` skill for `.test.ts` files and local test conventions
   - benchmark work: use the xterm.js `benchmark` skill for `*.benchmark.ts`
   - browser/UI verification: use Browser or Playwright when a real rendered surface matters
4. Do not blindly import ECC defaults that conflict with xterm.js conventions. This file's xterm.js-specific build, test, lint, API, and code style rules take precedence.
5. Do not install, update, or sync ECC assets from the network unless the user explicitly asks for installation or dependency changes.
6. If ECC guidance is needed beyond this file, consult the upstream repository first and cite the exact upstream source used.

### ECC Quality Bar

- Keep functions and files focused, with readable names and explicit error handling.
- Validate untrusted inputs at system boundaries.
- Never hardcode secrets; use environment variables or the repo's existing secret handling.
- After writing or modifying code, review for correctness, tests, security, and maintainability before finalizing.
- Capture durable project learnings in MemPalace, and put team/project docs in the repo's existing documentation structure when they belong there.

## Architecture Overview

**Core Structure**: xterm.js is a multi-target terminal emulator with three main distributions:
- `src/browser/`: Full-featured browser terminal with DOM rendering
- `src/headless/`: Server-side terminal for Node.js (no DOM)
- `src/common/`: Shared core logic (parsing, buffer management, terminal state)

**Key Classes**:
- `Terminal` (browser/headless): Public API wrapper
- `CoreTerminal` (common): Core terminal logic and state
- `CoreBrowserTerminal` (browser): Browser-specific terminal implementation

## Development Workflow

**Build System**:
```bash
npm run build && npm run esbuild # Build all TypeScript and bundle
```

**Testing**:
- Unit tests: `npm run test-unit` (Mocha)
- Unit tests filtering to file: `npm run test-unit -- **/fileName.ts`
- Per-addon unit tests: `npm run test-unit -- addons/addon-image/out-esbuild/*.test.js`
- Integration tests: `npm run test-integration` (Playwright across Chrome/Firefox/WebKit)
- Integration tests by file: `npm run test-integration -- test/playwright/InputHandler.test.ts`. Never use grep to filter tests, it doesn't work
- Integration tests by addon: `npm run test-integration -- --suite=addon-search`. Suites always follow the format `addon-<something>`
- Lint: `npm run lint` (oxlint with type-aware rules, then ESLint for `naming-convention` only), `npm run lint-api` for `typings/`, `npm run lint-fix` for oxlint auto-fix
- Lint changes: `npm run lint-changes` to lint only changed files, `npm run lint-changes-fix` to fix them

## Addon Development Pattern

All addons follow this structure:
```typescript
export class MyAddon implements ITerminalAddon {
  activate(terminal: Terminal): void {
    // Called when loaded via terminal.loadAddon()
    // Register handlers, access terminal APIs
  }
  dispose(): void {
    // Cleanup when addon is disposed
  }
}
```

**Key Examples**:
- `addons/addon-fit/`: Terminal sizing
- `addons/addon-webgl/`: GPU-accelerated rendering
- `addons/addon-search/`: Text search functionality

## Project-Specific Conventions

**TypeScript Project Structure**: Uses TypeScript project references (`tsconfig.all.json`) for incremental builds across browser/headless/addons.

**API Design**: 
- Browser and headless terminals share the same public API
- Proposed APIs require `allowProposedApi: true` option
- Constructor-only options (cols, rows) cannot be changed after instantiation

**Disposable Management**:
- When a disposable object can be replaced over time, prefer a registered `MutableDisposable` over manual dispose/reassign logic.
- Register it on the owning class (for example, `this._register(new MutableDisposable())`) and assign through `.value`; this automatically disposes the previous value and avoids accidentally leaking resources.

**TypeScript Constants**:
- Prefer `const enum` over top-level `const` declarations for primitive constants when appropriate, since values are inlined and avoid runtime property lookups.

**Testing Utilities**: Use `TestUtils.ts` helpers:
- `openTerminal(ctx, options)` for setup
- `pollFor(page, fn, expectedValue)` for async assertions
- `writeSync(page, data)` for terminal input

## Common Patterns

**Parser Integration**: Register custom escape sequence handlers:
```typescript
terminal.parser.registerCsiHandler('m', params => {
  // Handle SGR sequences
  return true; // Handled
});
```

**Buffer Access**: Read terminal content via buffer API:
```typescript
const line = terminal.buffer.active.getLine(0);
const cell = line?.getCell(0);
```

**Events**: All terminals emit standard events (onData, onResize, onRender) plus platform-specific ones.

## Critical Implementation Details

- Terminal rendering uses either DOM or WebGL renderers
- Buffer lines are immutable; create new instances for modifications
- Character width handling supports Unicode 11+ and grapheme clustering
- Mouse events translate web events to terminal protocols (X10, VT200, etc.)
- Color theming supports both palette and true color modes

## Writing unit tests

- Unit tests live alongside the source code file of the thing it's testing with a .test.ts suffix.

## Cursor Cloud specific instructions

**Demo server**: Start with `npm start` (port 3000). The demo server uses node-pty to spawn real shell sessions over WebSocket. Integration tests auto-start it via Playwright's `webServer` config, so you don't need to start it manually for `npm run test-integration`.

**Build before testing**: Always run `npm run build && npm run esbuild` before `npm run test-unit`. Integration tests also need `npm run esbuild-demo-client` and `npm run esbuild-demo-server`. The update script handles this automatically on session start.

**No external services**: This project has zero external dependencies (no databases, Docker, or APIs). Everything runs locally with Node.js.

**TypeScript compiler**: The project uses `tsgo` (native TypeScript compiler preview) rather than standard `tsc`. It's installed via the `@typescript/native-preview` package.

**Lint only changed files**: Prefer `npm run lint-changes` over `npm run lint` when iterating on code changes — it's significantly faster.
