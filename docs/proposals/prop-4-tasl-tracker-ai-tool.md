# Managers Agent Has Access to Task Tracker

## Problem

The codebase already contains the following pieces:

1. `TaskTracker` - a logic component that tracks tasks and sends reminders.
2. `TaskTrackerTools` - an `IToolchain` implementation that allows the LLM to read task tracker data.
3. `GroupChat` for the managers' chat - a component that mirrors messages from the managers' Telegram chat and stores them in the backlog.
4. `ManagersAgent` - an AI agent that reads the managers' chat context and replies to that chat.

The Task Tracker and its toolchain are described in the [Task Tracker Specification](../specs/spec-1-task-tracker.md).

The managers' chat and `ManagersAgent` are described in the [Managers Agent Specification](../specs/spec-2-managers-agent.md).

At the moment, `ManagersAgent` is initialized with `ManagersMessengerTools` only, so it can send messages but cannot query tasks.

## Proposal

`ManagersAgent` should also receive access to `TaskTrackerTools`.

This allows the agent to answer requests such as:

1. show the current tasks;
2. show tasks with a specific status;
3. find tasks that match a manager's request based on the fetched task data.

The agent must continue sending visible replies only through the messenger tool. `TaskTrackerTools` should be used only to fetch data that the agent then includes in its response.

## Implementation Details

`ManagersAgent` currently constructs `Agent` with a single toolchain. To support both messaging and task queries, it should construct a `ToolsMultiplexer` that contains:

1. `ManagersMessengerTools`;
2. `TaskTrackerTools`.

`TaskTrackerTools` should be created from `TaskTracker.get_tasks()`.

The integration should be enabled only when both of the following components are configured:

1. `managers_chat_agent`;
2. `task_tracker`.

If `task_tracker` is not configured, `ManagersAgent` should continue to work with `ManagersMessengerTools` only.

No new configuration fields are required for this integration.