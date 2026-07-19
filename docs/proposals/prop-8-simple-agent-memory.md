# Simple Agent Memory

Status: draft

Related specs:
- specs/spec-2-managers-agent.md

## Problem

Agents currently rely only on the active conversation context. When a user asks the bot to remember something, or asks about something that was stated earlier but is no longer in context, the agent has no durable place to store or retrieve that information.

Managers and choristers need a lightweight shared memory of facts that the agent can consult on demand, without loading the entire memory into every prompt.

## Proposal

Introduce a simple agent memory as a set of facts.

The user can explicitly ask the agent to remember or forget something. The agent stores that fact in memory.

When the user asks something that is not currently in context, the agent should try to consult memory.

When consulting memory, facts are **not** loaded into the agent in full. Instead, a separate sub-agent is started; it receives the question and searches for a matching fact or set of facts.

## Domain Model

Each fact has the following data:

1. **Unique key** (for internal use only) — a string in the format `DDMM_HHMM_XXXX`
2. **Author** — who asked the bot to remember this fact
3. **Visibility** — who can access this fact:
   - `specific_user`
   - `specific_group`
   - `global`

### Visibility rules

1. If a fact is created by a user in a private chat (chorister agent), its visibility is `specific_user` only. That fact is available only when the same user asks a question in the same chat.
2. If a fact is created in the managers group, its visibility is the managers group. That fact is available to all managers in the group and can be seen when questions are asked in that group or in managers' private chats.
3. By default, no fact may have `global` visibility. The user must explicitly ask to make a fact available to everyone.

## Service API

Add a new service interface `ISimpleMemoryService` with the following methods:

1. `remember` — store a fact
2. `forget` — remove a fact
3. `list` — get the list of facts available to the user
4. `ask` — ask a question to the sub-agent that searches for a matching fact or set of facts; returns the ids of relevant facts
5. `get` — get a fact by id

## Implementation Details

1. Implement `ISimpleMemoryService` on top of Firestore in the `memories` collection.
2. Create an `IToolchain` implementation that wraps the service.
3. Add this tool both to the managers agent and to every manager's toolchain.

## Outcome

After this proposal is implemented, agents can store and forget user-requested facts, and consult memory through a sub-agent search instead of loading all facts into the main agent context. Fact access is constrained by visibility (`specific_user`, managers group, or explicit `global`).
