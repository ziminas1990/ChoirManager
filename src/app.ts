import assert from "assert";
import { load_data } from "./csv_reader.js";
import { Database, Vocal } from "./data_model.js";

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
        participant.name, participant.surname, convert_vocal(participant.vocal));
    
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

const rehersals_summary = database.fetch_rehersals_summary();

rehersals_summary.forEach(summary => {
    console.log(`Rehersal on ${summary.date.toLocaleDateString()}`);
    summary.pieces.forEach(piece => {
        console.log(`\t${piece.piece.title}: ${piece.time} minutes`);
    });
    summary.choristers.forEach(chorister => {
        console.log(`\t${chorister.name} ${chorister.surname}`);
    });
});