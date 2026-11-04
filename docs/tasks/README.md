# Development tasks

This directory tracks work on ChoirManager. Tasks use `TASK-XXX`, and epics
use `EPIC-XXX`. Each sequence starts at `001` and advances beyond the highest
number among its open and closed documents.

```text
tasks.json
TASK-001.md
closed/
  TASK-002.md
epics/
  EPIC-001.md
  closed/
    EPIC-002.md
```

The filenames above illustrate the layout. The script creates archive and
epic directories when needed. A document is open in its working directory
and closed in its archive; there is no separate status field.

## Commands

Use Python 3.9 or newer. Run each example from the repository root:

```bash
cd docs/tasks && python3 ../../scripts/task.py create
cd docs/tasks && python3 ../../scripts/task.py create --epic
cd docs/tasks && python3 ../../scripts/task.py close TASK-001
cd docs/tasks && python3 ../../scripts/task.py close EPIC-001
```

Creation prints the new document's relative path. Fill in the generated
template after creation. Closing accepts a name with or without `.md` and
prints the archive path.

`tasks.json` configures the task prefix through `suffix` and the archive
directory through `closed` (default: `closed`). The script reads this file
from the shell's working directory. Task and epic numbers are allocated
independently, including archived documents; gaps are not reused.

## Writing and completion

Read [the writing rules](../../.cursor/rules/task-writing.mdc) before creating,
editing, or closing a task or epic. Tasks describe the problem, required
behavior, and observable acceptance criteria. Epics describe an overall goal
and link to the tasks that deliver it in the required order.

Check acceptance criteria before closing a task. Close an epic after its
steps are complete or document why it is being abandoned. The script handles
files and links; it does not validate completion or run tests.

Closing rewrites relative inline Markdown links throughout this directory,
including archived tasks and epics. It also adjusts the moved document's own
relative links. Links outside `docs/tasks/` are not scanned. Closed documents
are historical records and must never be edited by hand; only the script may
adjust their links when another document moves.
