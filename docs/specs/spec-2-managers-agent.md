# Managers Agent Specification

Proposals history:
- [Proposal 3: Managers Chat Agent](../proposals/prop-3-managers-chat-agent.md)

## What is the Managers Agent?

The Managers Agent is an AI agent that keeps all messages from the managers' chat from the last `N` days in its context. Each message in the context includes the following data:

1. id: string with the message id
2. time: string in `DD.MM, HH:MM` format
3. author: string in `Name (@telegram_username)` format
4. text: string with the message text

If the message was sent by the bot itself, it must also be included in the context with `Ursa Major Bot` as the author.

`ManagersAgent` should call the LLM only if the bot was mentioned in the message. The mention string is derived from `tg_adapter.bot_id`.

## Behavior

If the agent receives a message and invokes the LLM, it should send a `Typing` action to the managers' chat while the response is being generated.

The agent should send the LLM response to the managers' chat and add that response to both:

1. the agent context
2. the managers' chat backlog

The agent can send visible messages only by calling the Messenger tool.

Messages sent to the managers' chat by other bot components must also be added to the managers' chat backlog and to the agent context as bot-authored messages.

## Configuration

The managers' agent should be configured as follows:

```json
"managers_chat_agent": {
    "model": "gpt-5.4-mini",
    "context_days": 14,
    "prompt_file": "./config/managers_chat_agent_prompt.txt"
}
```

Additional requirements:

1. `openai_api_key_file` must be configured.
2. `tg_adapter.bot_id` must be configured so the bot mention can be detected.
3. `managers_chat.backlog` must be configured because the agent loads historical context from it.

## Implementation Details

The bot already forwards new messages from the managers' chat to `GroupChat`, which stores them in the backlog. However, the managers' chat did not previously have a dedicated AI entity.

We introduce a new `ManagersAgent` class. It receives:

1. the managers' `GroupChat`
2. the `managers_chat_agent` configuration
3. a way to send messages back to the managers' chat
4. a way to resolve user IDs into display names

`ManagersAgent` constructs an `Agent` instance with a retention time equal to `context_days` days. All new messages from the managers' chat are added to the agent's context.

When `ManagersAgent` is created, it must fetch all messages from the last `context_days` days from the managers' chat backlog and preload them into the agent context in chronological order.

When the bot sends a new message through the Messenger tool, that outgoing message must also be recorded in the backlog so that it is preserved across restarts.

The same applies to messages sent to the managers' chat by other bot components, such as `TaskTracker` notifications: they must also be recorded in the backlog and added to the agent context.
