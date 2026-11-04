# Release 1 update

This release moves users and Telegram bindings into Firestore. Deposits, transactions, statistics, scores, and feedback stay where they are and still look a user up by the exact Telegram username from the users spreadsheet. The migration keeps that username verbatim.

The bot cannot create users, remove users, or change roles in this release. A person who messages the bot for the first time is stored with no roles.

Chat settings (`choir_chat_id`, `announce_thread_id`, `managers_chat_id`) stay in `runtime.json`. The migration reports them and does not move them.

## Before you start

1. Note the image tag that is running. You need it for rollback.
2. Copy the whole `config/` directory, including `runtime.json` and `botcfg.json`, to a place the new process will not overwrite.
3. Confirm `botcfg.json` points `user_service` and `tg_adapter.users_storage` at the Firestore database you want to fill. The nested `type` and `storage` fields are the ones the process reads.

The new process rewrites `runtime.json` and drops `tg_adapter.users`. The copy from step 2 is what rollback restores. Do not point the migration at that copy; point it at the live file, or at a duplicate you are willing to treat as the source.

## Dry run

Stop nothing yet. From the directory that contains `config/` and `logs/` on the server:

```bash
docker run --rm --network=host \
  -v "$(pwd)/config:/mnt/config" \
  -v "$(pwd)/logs:/mnt/logs" \
  ziminas1990/ursa-major-agent:latest \
  node migrate.cjs \
    --users-sheet-id SHEET_ID \
    --report /mnt/logs/migrate-release-1-report.json
```

`SHEET_ID` is the users spreadsheet. The command reads `config/botcfg.json` and, unless you pass `--runtime`, the `runtime_cache_filename` in that file (the image links `/mnt/config` as `config/`). The runtime file must be version 2 or 3, with Telegram users still listed in it. A version 4 file is rejected: the new bot has already dropped those users from `runtime.json`, and a migration of that file would report nobody.

Dry run is the default. It writes the report and does not change Firestore. Exit 0 means the plan has no skipped rows, conflicts, or read errors. Exit 1 means the migration is incomplete: read the report before applying.

The report lists each record as `created`, `unchanged`, `updated`, `skipped`, `conflict`, or `error`. Conflicts include:

- a duplicate `tgid`
- usernames that differ only by case or a leading `@` (these would break the deposit link if one overwrote the other)
- one Telegram id claimed by several users
- the same username with more than one chat id
- a runtime user with no `chat_id`
- a stored binding that matches nobody

Users who appear only in `runtime.json` are created with no roles. They are marked runtime-only in the report.

Fix the sources and run the dry run again until it exits 0. A username that differs only by case from the spreadsheet is reported and not merged; leave the spreadsheet username as the one deposits already use.

## Apply

Stop the bot so it is not writing `runtime.json` or Firestore at the same time. One writer is assumed.

```bash
docker kill ursa-major-agent
docker run --rm --network=host \
  -v "$(pwd)/config:/mnt/config" \
  -v "$(pwd)/logs:/mnt/logs" \
  ziminas1990/ursa-major-agent:latest \
  node migrate.cjs \
    --users-sheet-id SHEET_ID \
    --report /mnt/logs/migrate-release-1-report.json \
    --apply
```

The command writes users first, then Telegram bindings, then reads them back. Every migrated binding must point at a user. Exit 1 if any write or that check fails.

Run the same command again. A finished migration reports `unchanged` for every record, keeps the ids assigned the first time, and exits 0. If the first apply stopped part way, run it again; it will not create a second user for a username that is already stored.

## Start the new version

```bash
docker pull ziminas1990/ursa-major-agent:latest
docker rm ursa-major-agent
docker run -ti --network=host \
  -v "$(pwd)/config:/mnt/config" \
  -v "$(pwd)/logs:/mnt/logs" \
  -d --name ursa-major-agent --restart unless-stopped \
  ziminas1990/ursa-major-agent:latest
```

If `botcfg.json` still contains `administration_service`, the log warns that it is ignored.

## Smoke checks

- An existing member can open their previous deposit and transaction history.
- Statistics, scores, and feedback still resolve that member.
- A notification goes out, an announcement is translated, and the managers chat answers.
- Restart the container. The managers chat id, announce thread, and private chat ids are still in effect.
- Asking the bot to add a user, remove a user, or change a role does nothing of that kind. A new sender is stored with no roles.

## Rollback

1. Stop and remove the new container.
2. Restore `runtime.json` and `botcfg.json` from the copy you saved. The sheets were not modified. Firestore rows written by the migration can stay; the previous image does not read them.
3. Start the saved image tag with the same `docker run` as before.

```bash
docker kill ursa-major-agent
docker rm ursa-major-agent
# restore config/runtime.json and config/botcfg.json from the backup
docker run -ti --network=host \
  -v "$(pwd)/config:/mnt/config" \
  -v "$(pwd)/logs:/mnt/logs" \
  -d --name ursa-major-agent --restart unless-stopped \
  ziminas1990/ursa-major-agent:PREVIOUS_TAG
```
