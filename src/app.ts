import assert from "assert";
import { Database, Vocal } from "./data_model.js";
import fs from 'fs';
import mustache from 'mustache';

import { load_spreadsheet } from "./extractors/google_spreadsheet.js"
import { load_csv_data } from "./extractors/csv_reader.js";
import { StatusWith } from "./status.js";
import { Data } from "./extractors/types.js";

async function load_data(source: "csv" | "google spreadsheet"): Promise<StatusWith<Data>> {
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

if (!status_and_data.is_ok()) {
    console.error("Failed to read data:", status_and_data.what());
    process.exit(1);
}

const data = status_and_data.value!;

function convert_vocal(vocal: string): Vocal {
    switch (vocal) {
        case 'Soprano':
            return Vocal.Soprano;
        case 'Alto':
            return Vocal.Alto;
        case 'Tenor':
            return Vocal.Tenor;
        case 'Bass':
            return Vocal.Bass;
    }
    return Vocal.Unknown;
}

const database = new Database();

const rehersals = data.rehersals.map(rehersal => {
    return database.create_rehersal(rehersal);
});

data.participants.forEach(participant => {
    const chorister = database.create_chorister(
        participant.name, participant.surname, convert_vocal(participant.vocal), participant.joined);
    
    participant.minutes.forEach((time, index) => {
        if (time > 0) {
            assert(index < rehersals.length);
            const rehersal = rehersals[index];
            assert(rehersal);
            database.join_rehersal(chorister, rehersal);
        }
    });
});

data.songs.forEach(song => {
    const piece = database.create_piece('Unknown', song.name);

    song.minutes.forEach((time, index) => {
        if (time > 0) {
            const rehersal = rehersals[index];
            database.rehersal_song(rehersal, piece, time);
        }
    });
});


const report_template = fs.readFileSync('./src/report.template.html', 'utf8');
const render_options = {
    escape: (text: string) => text
}
const report = mustache.render(report_template, {
    packed_json: JSON.stringify(database.pack()),
    application_code: fs.readFileSync('./dist/webapp/index.js', 'utf8')
}, undefined, render_options);
fs.writeFileSync('report.html', report);