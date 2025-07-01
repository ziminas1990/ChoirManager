# Deployment guide
This is a draft document. I'll finish it once, but now it will just a bunch of different reminders.

## Firestore
### Provide access rights to service account
In ["IAM & Admin -> Service Accounts"](https://console.cloud.google.com/iam-admin/serviceaccounts) select "Manage Permissions" action for your service account and grant the following role: "Firebase Rules System". Without this role your service account won't be allowed to read/write to your firestore database.

## Create database
In your [Firestore Panel](https://console.cloud.google.com/firestore/databases) create a new database, that will be used to store documents. The name of the database should be specified as `firestore_database_id` parameter in the configuration file.