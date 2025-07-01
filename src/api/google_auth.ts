import fs from "fs";
import { google, Auth, sheets_v4, docs_v1 } from "googleapis";

import { Status } from "@src/status.js";
import { Firestore } from "@google-cloud/firestore";

const scopes = [
    'https://www.googleapis.com/auth/cloud-platform',   // Firestore
    'https://www.googleapis.com/auth/drive',            // Drive access
    'https://www.googleapis.com/auth/spreadsheets',     // Sheets
    'https://www.googleapis.com/auth/documents'         // Docs
];

export class GoogleAuth {

    private static google_cloud_key_file: string;
    private static auth?: Auth.GoogleAuth;
    private static sheets?: sheets_v4.Sheets;
    private static documents?: docs_v1.Docs;
    private static firestore: Map<string, Firestore> = new Map();

    public static async authenticate(google_cloud_key_file: string): Promise<Status> {

        GoogleAuth.google_cloud_key_file = google_cloud_key_file;

        let credentials: any | undefined = undefined;
        try {
            credentials = JSON.parse(fs.readFileSync(google_cloud_key_file, "utf8"));
        } catch (error) {
            return Status.fail(`Failed to load credentials: ${error}`);
        }
        if (!credentials) {
            return Status.fail("Failed to load credentials. File is empty?");
        }

        GoogleAuth.auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: scopes,
        });

        return Status.ok();
    }

    public static get_sheets(): sheets_v4.Sheets {
        if (!GoogleAuth.sheets) {
            GoogleAuth.sheets = google.sheets({ version: "v4", auth: GoogleAuth.get_auth() });
        }
        return GoogleAuth.sheets;
    }

    public static get_documents(): docs_v1.Docs {
        if (!GoogleAuth.documents) {
            GoogleAuth.documents = google.docs({ version: "v1", auth: GoogleAuth.get_auth() });
        }
        return GoogleAuth.documents;
    }

    public static get_firestore(database_id: string): Firestore {
        if (!GoogleAuth.firestore.has(database_id)) {
            const instance = new Firestore({
                databaseId: database_id,
                keyFilename: GoogleAuth.google_cloud_key_file,
            });
            GoogleAuth.firestore.set(database_id, instance);
        }
        return GoogleAuth.firestore.get(database_id)!;
    }

    private static get_auth(): Auth.GoogleAuth {
        if (!GoogleAuth.auth) {
            throw new Error("Google Auth is not initialized");
        }
        return GoogleAuth.auth;
    }
}