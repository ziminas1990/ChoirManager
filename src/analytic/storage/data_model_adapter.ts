import * as db from "@src/analytic/data_model.js";
import { Expected, Status } from "@src/utils/expected.js";

export type Row = string[];
export type Table = Row[];

// Assuming the date format is DD.MM.YY
function parse_date(date: string): Date {
    const parts = date.split('.');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are zero-indexed in JS
    const year = parseInt(parts[2], 10) + 2000; // Assuming the year is in the 2000s
    const date_js = new Date(year, month, day);
    return date_js;
}

function check_header(header: Row): Status {
    const [tag, joined, who,] = header;

    if (tag.toLowerCase() !== "tag") {
        return Expected.err("First column must be 'Tag'");
    }
    if (joined.toLowerCase() !== "joined") {
        return Expected.err("Second column must be 'Joined'");
    }
    if (who.toLowerCase() !== "who") {
        return Expected.err("Third column must be 'Who'");
    }
    return Expected.ok(undefined);
}

function read_song_data(row: Row, song_id: number, database: db.Database): Status {
    const [,, name, ...minutes] = row;
    const song_status = database.create_piece(song_id, "Unknown", name);
    if (!song_status.ok) {
        return song_status.wrap_error("Can't create song");
    }

    minutes.forEach((minute, rehersal_id) => {
        const minutes = parseInt(minute);
        if (minutes > 0) {
            database.rehersal_song(rehersal_id, song_id, minutes);
        }
    });

    return Expected.ok(undefined);
}

function read_chorister_data(row: Row, chorister_id: number, database: db.Database): Status {
    const vocals = {
        soprano: db.Vocal.Soprano,
        alto: db.Vocal.Alto,
        tenor: db.Vocal.Tenor,
        bass: db.Vocal.Bass
    };

    const [voice, joined, name_surname, ...hours] = row;

    if (!Object.keys(vocals).includes(voice.toLowerCase())) {
        return Expected.err(`Unexpected vocal type: '${voice}'`)
    }
    const vocal = vocals[voice.toLowerCase() as keyof typeof vocals];

    const [name, surname] = name_surname.split(' ');
    const joined_date = parse_date(joined);

    const chorister_status = database.create_chorister(chorister_id, name, surname, vocal, joined_date);
    if (!chorister_status.ok) {
        return chorister_status.wrap_error("Can't create chorister");
    }

    hours.forEach((hour, rehersal_id) => {
        const minutes = parseInt(hour) * 60;
        if (minutes > 0) {
            database.join_rehersal(rehersal_id, chorister_id, minutes);
        }
    });
    return Expected.ok(undefined);
}

export function build_data_model(data: Table): Expected<db.Database> {
    const header = data[0];

    {
        const status = check_header(header);
        if (!status.ok) {
            return status.wrap_error("Table has invalid header");
        }
    }

    const data_model = new db.Database();

    // Creating all rehersals
    const rehersal_dates = header.slice(3);
    rehersal_dates.forEach((date, rehersal_id) => {
        data_model.create_rehersal(rehersal_id, parse_date(date));
    });

    let next_piece_id = 1;
    let next_chorister_id = 1;

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const tag = row[0];
        if (tag.toLowerCase() === "song") {
            const status = read_song_data(row, next_piece_id++, data_model);
            if (!status.ok) {
                console.warn(`Error in row ${i}: ${status.error}`);
            }
        } else {
            const status = read_chorister_data(row, next_chorister_id++, data_model);
            if (!status.ok) {
                console.warn(`Error in row ${i}: ${status.error}`);
            }
        }
    }

    return Expected.ok(data_model);

}