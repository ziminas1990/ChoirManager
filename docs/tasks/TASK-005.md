# TASK-005: Preserve reply relationships in the managers chat and pass them to the LLM

## Background

Messages from the Telegram managers chat are stored in Firestore, but the
relationship between a reply and its original message is lost. The LLM receives
text without this relationship and cannot reliably determine which proposal
a reply such as “Yes, I agree” refers to.

## Require

Enrich stored conversations with reply metadata from Telegram. Each reply must
retain a reference to the original message and the available details about it:

- identifier;
- text;
- author.

Include this relationship in the LLM context when processing new messages and
loading conversation history. The available details must preserve the meaning
of a reply even when the original message falls outside the loaded time range.

Maintain compatibility with previously stored conversations. Missing metadata
in an older record must not be treated as confirmation that it was not a reply.

## Acceptance

- For a new message sent as a reply in Telegram, Firestore stores its
  relationship to the correct original message and the available details
  about that message.
- The LLM receives an explicit relationship between the reply and its original
  message both when the reply arrives and after a restart and history reload
  from Firestore.
- When the original message falls outside the loaded time range, the LLM
  context still includes the available details about it and its relationship
  to the reply.
- In a reply chain, each message is linked to the message it directly replies to.
- Editing a reply's text does not lose the stored relationship.
- Ordinary messages and older records without metadata continue to be processed;
  relationships are not inferred from message text.
- The conditions under which the bot responds in the managers chat remain
  unchanged.
