# TASK-024: Generate and publish automatic AI reports with chat history

## Background

Recurring report definitions need an execution capability that gives an AI agent
the configured prompt and recent conversation context, then publishes the
result to the configured chat.

This task belongs to [EPIC-001](epics/EPIC-001.md) and depends on the report
contracts in [TASK-023](TASK-023.md).

## Require

Add an asynchronous Automatic AI Reports service capability to execute a report
occurrence independently of the scheduler. Follow the project's service and
factory boundaries, keeping execution behavior separate from storage.

Run an AI agent with the report prompt and the requested number of days of
history from the destination chat. Anchor the history window to the occurrence
being reported and preserve the existing conversation context semantics.
Use the existing AI and analytics capabilities when the prompt needs them.

Publish the resulting report as bot messages to the configured destination after
successful generation. Automatic reports do not require the two manual
administrator confirmations from [TASK-021](TASK-021.md).

Keep the internal report name out of published content. Report generation and
publication outcomes through the service and operational logging.

## Acceptance

- Execution supplies the configured prompt and destination-chat history to the
  agent. Context does not include unrelated chats or messages outside the
  requested time window.
- A zero-day history setting supplies no chat history. An empty history window
  still allows the agent to process the prompt.
- The context window ends at the scheduled occurrence time, so execution delays
  do not shift the requested period.
- Successful generation publishes the report to the configured chat without
  manual approval and without exposing its internal report name.
- Reports that exceed a single Telegram message are delivered in order without
  truncation or broken formatting.
- Failed generation does not publish an empty report or a success notice.
  Delivery failures, including partial delivery, are visible as failed outcomes.
- Failure of one report does not prevent other reports from executing.
