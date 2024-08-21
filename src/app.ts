import assert from "assert";
import { load_data } from "./csv_reader.js";
import { Database, Vocal } from "./data_model.js";
import fs from 'fs';
import mustache from 'mustache';

const data = load_data('data.csv');

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
    packed_json: JSON.stringify(database.pack())
}, undefined, render_options);
fs.writeFileSync('report.html', report);