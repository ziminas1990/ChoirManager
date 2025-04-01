import { Database } from "./data_model.js";
import fs from 'fs';
import mustache from 'mustache';

import { load_spreadsheet } from "./storage/google_spreadsheet.js"
import { load_csv_data } from "./storage/csv_file.js";
import { StatusWith } from "../status.js";

async function load_data(source: "csv" | "google spreadsheet"): Promise<StatusWith<Database>> {
    switch (source) {
        case "csv":
            return load_csv_data('data.csv');
        case "google spreadsheet":
            const sheet_id = "1v97DtsLwKh0fxIGUoZOioRkHvHJxQRSNJRxwPFdym44"
            const credentials_file = "./src/extractors/credentials.json"
            return load_spreadsheet(credentials_file, sheet_id);
    }
}

const status_and_data = await load_data("csv");

if (!status_and_data.done()) {
    console.error("Failed to read data:", status_and_data.what());
    process.exit(1);
}

const database = status_and_data.value!;

// Generate HTML document
const report_template = fs.readFileSync('./src/report.template.html', 'utf8');
const render_options = {
    escape: (text: string) => text
}

const packed_database = Database.pack(database);

const report = mustache.render(report_template, {
    packed_json: JSON.stringify(packed_database),
    application_code: fs.readFileSync('./dist/webapp/index.js', 'utf8')
}, undefined, render_options);
fs.writeFileSync('report.html', report);