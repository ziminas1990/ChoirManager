import { google } from 'googleapis';
import fs from 'fs';

import { Status, StatusWith } from "../status.js"
import { Data } from './types.js';
import { parse_raw_data } from './parse_raw_data.js';

export type Row = string[];
export type Table = Row[];

export async function load_spreadsheet(
    credentials_file: string,
    sheet_id: string)
: Promise<StatusWith<Data>>
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
    return Status.ok().with(parse_raw_data(data));
}