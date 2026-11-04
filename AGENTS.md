# Project instructions for agents

Project rules live in [`.cursor/rules/`](.cursor/rules/). Read the rules that
apply to your work; rules marked `alwaysApply` apply across the project.

- [general_rules.mdc](.cursor/rules/general_rules.mdc) — comment style and
  mandatory task workflow; always applies.
- [architecture_guideline.mdc](.cursor/rules/architecture_guideline.mdc) —
  storage, service, and factory boundaries; always applies.
- [typescript_codestyle.mdc](.cursor/rules/typescript_codestyle.mdc) — class
  member order and helper extraction; always applies.
- [docs-agent-guide.mdc](.cursor/rules/docs-agent-guide.mdc) — read
  [docs/AGENT.md](docs/AGENT.md) before working with documentation.
- [task-writing.mdc](.cursor/rules/task-writing.mdc) — read before creating,
  editing, or closing tasks or epics under `docs/tasks/`.

## Development tasks and epics

Development tasks use `TASK-XXX`; epics use `EPIC-XXX`, with independent
numbering starting at `001`. This is the project's development tracking
workflow; all tracking documents live under `docs/tasks/`.
These documents track repository work; the application's task tracker is a
separate feature.

Create and close documents only with `scripts/task.py`, using Python 3.9 or
newer. Run commands from the repository root with the directory change in the
same command:

```bash
cd docs/tasks && python3 ../../scripts/task.py create
cd docs/tasks && python3 ../../scripts/task.py create --epic
cd docs/tasks && python3 ../../scripts/task.py close TASK-001
cd docs/tasks && python3 ../../scripts/task.py close EPIC-001
```

Each example starts from the repository root. Never allocate numbers, create
task or epic files, or move them into an archive by hand. Closed documents are
immutable historical records; only the script may update their links.

Write all tasks and epics in English, including titles and body text.
Write tasks as short descriptions of what must change and why, using
`Background`, `Require`, and `Acceptance`. Follow the full writing rules linked
above. See [the tracker guide](docs/tasks/README.md) for layout and behavior.

Verify changes to the tracking script with:

```bash
python3 -B scripts/test_task.py
```
