import { Data } from "./types";

export type Row = string[];
export type Table = Row[];

// Assuming the date format is DD.MM.YY
function parse_date(date: string): Date {
    const parts = date.split('.');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are zero-indexed in JS
    const year = parseInt(parts[2], 10) + 2000; // Assuming the year is in the 2000s
    return new Date(year, month, day);
}

export function parse_raw_data(table: Table): Data {
    const vocals = ['soprano', 'alto', 'tenor', 'bass'];

    const header = table[0];
    //console.log(header)

    const [,, ...dates] = header;

    const result = {
        rehersals: dates.map(parse_date),
        participants: [],
        songs: []
    } as Data;
    
    table.slice(1).forEach((row) => {
        const tag = row[0];
        if (tag.toLowerCase() === "song") {
            const [,, name, ...minutes] = row;
            result.songs.push({
                name,
                minutes: minutes.map((minutes) => parseInt(minutes) ?? 0)
            });
        } else if (vocals.includes(tag.toLowerCase())) {
            const [, joined, chorister, ...hours] = row;
            const [name, surname] = chorister.split(' ');
            result.participants.push({
                vocal: tag,
                name,
                surname,
                joined: parse_date(joined),
                minutes: hours.map(h => 60 * parseInt(h) ?? 0)
            });
        }
    });
    
    return result;
}