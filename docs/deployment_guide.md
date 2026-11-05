# Deployment guide

This is a draft document. I'll finish it once, but now it will just a bunch of different reminders.

## Release 1

To move existing users and Telegram bindings into Firestore, update the running bot, and roll back, follow [the release 1 procedure](release_1_update.md). Service config uses a nested `type` and `storage` object; see `config/botcfg.template.json`.

## Language models

`model` is required in `assistant`, `managers_chat_agent`, `scores_service`, and
`simple_memory`. The configuration template uses `gpt-6-luna` for `assistant`,
`scores_service`, and `simple_memory`, and `gpt-6.1-terra` for `managers_chat_agent`.
Model names must match this list exactly, ignoring letter case:

- `gpt-6.1-terra`
- `gpt-6.1-sol`
- `gpt-6-luna`
- `gpt-5.6-luna` (deprecated)
- `gpt-5.6-terra` (deprecated)
- `gpt-4o` (deprecated)
- `gpt-4o-mini` (deprecated)

Short names, extra whitespace, snapshots, and unlisted models are rejected.
The listed deprecated models remain configurable for compatibility and emit
a warning when selected. Deprecation here is ChoirManager's policy, independent
of OpenAI's availability or retirement schedule.

The listed generation 6 models use the Responses API for text, JSON output,
function calls, and streaming. Provider output, including encrypted reasoning,
is replayed with tool results on subsequent calls; responses use `store: false`.
Older models retain the Chat Completions path.

The endpoint requirement follows OpenAI's [Sol documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
and [Terra documentation](https://developers.openai.com/api/docs/models/gpt-6.1-terra).
See the [Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses)
for function-call formats and stateless reasoning replay.

## Firestore

### Provide access rights to service account

In ["IAM & Admin -> Service Accounts"](https://console.cloud.google.com/iam-admin/serviceaccounts) select "Manage Permissions" action for your service account and grant the following role: "Firebase Rules System". Without this role your service account won't be allowed to read/write to your firestore database.

## Create database

In your [Firestore Panel](https://console.cloud.google.com/firestore/databases) create a new database, that will be used to store documents. Put its id in the nested `storage.database_id` field of each Firestore service in the configuration file (see `config/botcfg.template.json`).
