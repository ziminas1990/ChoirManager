import * as db from "../data_model.js";
import { Status, StatusWith } from "../status.js";

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
        return Status.fail("First column must be 'Tag'");
    }
    if (joined.toLowerCase() !== "joined") {
        return Status.fail("Second column must be 'Joined'");
    }
    if (who.toLowerCase() !== "who") {
        return Status.fail("Third column must be 'Who'");
    }
    return Status.ok();
}

function read_song_data(row: Row, song_id: number, database: db.Database): Status {
    const [,, name, ...minutes] = row;
    const song_status = database.create_piece(song_id, "Unknown", name);
    if (!song_status.done() || !song_status.value) {
        return song_status.wrap("Can't create song");
    }

    minutes.forEach((minute, rehersal_id) => {
        const minutes = parseInt(minute);
        if (minutes > 0) {
            database.rehersal_song(rehersal_id, song_id, minutes);
        }
    });

    return Status.ok();
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
        return Status.fail(`Unexpected vocal type: '${voice}'`)
    }
    const vocal = vocals[voice.toLowerCase() as keyof typeof vocals];

    const [name, surname] = name_surname.split(' ');
    const joined_date = parse_date(joined);

    const chorister_status = database.create_chorister(chorister_id, name, surname, vocal, joined_date);
    if (!chorister_status.done() || !chorister_status.value) {
        return chorister_status.wrap("Can't create chorister");
    }

    hours.forEach((hour, rehersal_id) => {
        const minutes = parseInt(hour) * 60;
        if (minutes > 0) {
            database.join_rehersal(rehersal_id, chorister_id, minutes);
        }
    });
    return Status.ok();
}

export function build_data_model(data: Table): StatusWith<db.Database> {
    const header = data[0];

    {
        const status = check_header(header);
        if (!status.done()) {
            return status.wrap("Table has invalid header");
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
            if (!status.done()) {
                console.warn(`Error in row ${i}: ${status.what()}`);
            }
        } else {
            const status = read_chorister_data(row, next_chorister_id++, data_model);
            if (!status.done()) {
                console.warn(`Error in row ${i}: ${status.what()}`);
            }
        }
    }

    return Status.ok().with(data_model);

}