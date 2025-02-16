import { google } from 'googleapis';
import fs from 'fs';

import { Status, StatusWith } from "../status.js"
import { Table, build_data_model } from './data_model_adapter.js';
import { Database } from 'src/data_model.js';

export async function load_spreadsheet(
    credentials_file: string,
    sheet_id: string)
: Promise<StatusWith<Database>>
{

    let credentials: any | undefined = undefined;
    try {
        credentials = JSON.parse(fs.readFileSync(credentials_file, "utf8"));
    } catch (error) {
        return Status.fail(`Failed to load credentials: ${error}`);
    }

    if (!credentials) {
        return Status.fail("Failed to load credentials");
    }

    const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth: auth });

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheet_id,
        range: "1:100"
    });

    const data = response.data.values as Table;
    return build_data_model(data)
}