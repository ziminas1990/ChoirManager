import { GoogleAuth } from "@src/api/google_auth.js";
import { Status } from "@src/status.js";

export type OldMessage = {
    time: Date,
    sender: string,
    text: string,
}

export type NewMessage = {
    time: Date,
    sender: string,
    text: string,
}

function update_message(old_message: OldMessage): NewMessage | undefined {
    const names_to_id: Record<string, string> = {
        "Александр Зимин": "alexander_in_tg",
        "Анастасия Дорожкина": "risenroad",
        "Евгений Иванов": "evgecsh",
        "Ирина Тищенко": "irina_tishe",
        "Полина Калач": "kudzierka",
        "Тимур Аитов": "ddwgg"
    }

    const sender_id = names_to_id[old_message.sender];
    if (!sender_id) {
        console.log(`Unknown sender: ${old_message.sender}`);
        return undefined;
    }

    return {
        time: old_message.time,
        sender: sender_id,
        text: old_message.text,
    }
}

async function process_messages(database_name: string, collection_name: string, dry_run: boolean = true): Promise<Status> {
    try {
        // Get Firestore instance
        const db = GoogleAuth.get_firestore(database_name);
        const collection = db.collection(collection_name);

        console.log(`Reading all messages from collection: ${collection_name}`);
        if (dry_run) {
            console.log("DRY RUN MODE: No changes will be made to the database");
        }

        // Read all documents from the collection
        const snapshot = await collection.get();

        if (snapshot.empty) {
            console.log("No messages found in the collection");
            return Status.ok();
        }

        console.log(`Found ${snapshot.size} messages to process`);

        let processed_count = 0;
        let skipped_count = 0;
        let error_count = 0;

        // Process each document one by one
        for (const doc of snapshot.docs) {
            try {
                const data = doc.data();

                // Convert Firestore timestamp to Date if needed
                const time = data.time instanceof Date ? data.time : data.time.toDate();

                const old_message: OldMessage = {
                    time: time,
                    sender: data.sender,
                    text: data.text
                };

                const new_message = update_message(old_message);

                if (new_message) {
                    if (dry_run) {
                        // In dry-run mode, just log what would be changed
                        console.log(`[DRY RUN] Would update message ${doc.id}: ${old_message.sender} -> ${new_message.sender}`);
                    } else {
                        // Update the document with new sender ID
                        await doc.ref.update({
                            sender: new_message.sender
                        });
                        console.log(`Updated message ${doc.id}: ${old_message.sender} -> ${new_message.sender}`);
                    }
                    processed_count++;
                } else {
                    skipped_count++;
                    console.log(`Skipped message ${doc.id}: unknown sender "${old_message.sender}"`);
                }
            } catch (error) {
                error_count++;
                console.error(`Error processing document ${doc.id}:`, error);
            }
        }

        console.log(`Processing complete:`);
        console.log(`  - ${dry_run ? 'Would update' : 'Updated'}: ${processed_count} messages`);
        console.log(`  - Skipped: ${skipped_count} messages`);
        console.log(`  - Errors: ${error_count} messages`);

        if (dry_run && processed_count > 0) {
            console.log(`\nTo apply these changes, run with dry_run=false`);
        }

        return Status.ok();
    } catch (error) {
        return Status.exception(error).wrap("Failed to process messages");
    }
}

async function main() {
    const database_name = "ursa-major-db";
    const collection_name = "managers_chat_backlog";
    const google_cloud_key_file = "./config/google_cloud_key.json";
    const dry_run = true; // Set to false to actually apply changes

    console.log("Starting Firestore message updater...");
    console.log(`Database: ${database_name}`);
    console.log(`Collection: ${collection_name}`);
    console.log(`Dry run mode: ${dry_run ? 'ENABLED' : 'DISABLED'}`);

    // Initialize Google Auth
    console.log("Initializing Google Auth...");
    const auth_status = await GoogleAuth.authenticate(google_cloud_key_file);
    if (!auth_status.ok()) {
        console.error(`Google Auth failed: ${auth_status.what()}`);
        process.exit(1);
    }
    console.log("Google Auth initialized successfully");

    // Process messages
    const process_status = await process_messages(database_name, collection_name, dry_run);
    if (!process_status.ok()) {
        console.error(`Failed to process messages: ${process_status.what()}`);
        process.exit(1);
    }

    console.log("Firestore message updater completed successfully");
}

main().catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
});