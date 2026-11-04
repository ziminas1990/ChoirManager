# Deployment guide

This is a draft document. I'll finish it once, but now it will just a bunch of different reminders.

## Release 1

To move existing users and Telegram bindings into Firestore, update the running bot, and roll back, follow [the release 1 procedure](release_1_update.md). Service config uses a nested `type` and `storage` object; see `config/botcfg.template.json`.

## Firestore

### Provide access rights to service account

In ["IAM & Admin -> Service Accounts"](https://console.cloud.google.com/iam-admin/serviceaccounts) select "Manage Permissions" action for your service account and grant the following role: "Firebase Rules System". Without this role your service account won't be allowed to read/write to your firestore database.

## Create database

In your [Firestore Panel](https://console.cloud.google.com/firestore/databases) create a new database, that will be used to store documents. Put its id in the nested `storage.database_id` field of each Firestore service in the configuration file (see `config/botcfg.template.json`).