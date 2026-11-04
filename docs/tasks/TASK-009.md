# TASK-009: Remove the bot's Task Tracker and its exclusive infrastructure

## Background

The bot's Task Tracker has been rejected as an unsuccessful feature. It is still
available to managers through the managers chat agent and their personal
assistant. Its background processing also publishes task changes and deadline
notifications.

Leaving the feature disabled would retain unnecessary code and dependencies.
Remove it completely, including mechanisms that have no remaining consumers.

## Require

Remove the Task Tracker without a replacement or backward compatibility:

- Remove task management and persistence, including the task domain model.
- Remove task tools from both AI assistants and remove their task-specific
  instructions.
- Remove task events and deadline notifications, including their background
  processing and message formatting.
- Remove task configuration and service wiring, including exposed dependencies.
- Remove supporting mechanisms used exclusively by the Task Tracker.

Preserve shared infrastructure and other bot capabilities. Keep current project
guidance consistent with the removal. The development tracker under
`docs/tasks/` is a separate system and must remain intact.

No migration of task data is required. Document the retirement of the old task
collection as a deployment operation separate from removing application code.

## Acceptance

- The bot starts with configuration that contains no Task Tracker settings and
  does not initialize or access task storage.
- Neither AI assistant exposes tools to list or manage tasks. Their instructions
  no longer promise task operations or automatic task confirmations.
- Creating task events and sending task or deadline notifications are no longer
  supported by the application.
- No Task Tracker implementation, configuration contract, or exclusive helper
  remains. There are no compatibility adapters or disabled placeholders.
- Managers chat replies and chat history continue working. Shared memory and
  the personal assistant's other tools remain available.
- Deposit operations and their event-driven notifications continue working.
- Configuration examples and current project guidance reflect the removal.
  Deployment guidance distinguishes the obsolete task collection from shared
  Firestore resources.
- The development tracker and historical task documents remain intact.
- A clean production build succeeds without stale Task Tracker build artifacts.

## Plan

### 1. Remove the Task Tracker implementation

Delete the task domain model, service and storage interfaces, service component,
and both adapter stacks. Remove the task AI toolchain and event renderer.
This also removes the local task snapshot and all deadline scheduling logic.

### 2. Remove configuration and runtime wiring

Remove the Task Tracker contract, parsing, and validation from `BotConfig`.
Remove its section from `config/botcfg.template.json`. Remove the service and its
dedicated broadcaster from `Runtime`, including initialization and periodic
processing. Remove its accessors from `Environment` and `IEnvironment`.

### 3. Simplify the AI assistant integrations

Remove task event subscription and polling from `ManagersAgent`. Remove its
`extra_tools` constructor parameter and registration branch, which currently
serve only the Task Tracker. Preserve messenger and memory tools.

Remove task tool registration from the personal assistant's tool factory and
dependency passing in `ChoristerDialog`. Clean the managers agent prompt of task
instructions, obsolete tool names, and rules that wait for task notifications.

### 4. Remove exclusive helpers and verify shared consumers

Delete `src/utils/common_parsers.ts`: its date parsers currently serve only task
tools. Remove `generate_task_id` from `src/utils/misc.ts`, keeping the memory ID
generator and its supporting code.

Retain the broadcaster and subscription infrastructure used by deposits. Keep
the shared rate limiter, AI tool infrastructure, and Firestore dependencies.
Check remaining consumers before removing any further helper or dependency.

### 5. Update guidance and prepare deployment cleanup

Remove Task Tracker references from the architecture examples and the obsolete
distinction in `AGENTS.md`. Preserve the repository's development task workflow
and historical tracking documents.

Document removal of the task section from deployed configurations. Record the
old storage location before removing those settings. Explain how to retire that
collection if its documents are to be deleted; do not delete the shared database
or chat history. Do not add startup migrations or automatic data deletion.

### 6. Verify removal and remaining behavior

Search active source, configuration examples, and prompts for residual Task
Tracker references. Clear generated output and run `npm run build` so obsolete
compiled modules cannot remain in `dist`.

Verify startup without task configuration and inspect both assistants' exposed
tools. Check managers chat replies and history, shared memory, and the personal
assistant's remaining tools. Exercise a deposit operation that emits a
notification to verify the shared event delivery path still works.
