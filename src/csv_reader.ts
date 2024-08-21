import * as fs from 'fs';

export type Chorister = {
    vocal: string,
    name: string,
    surname: string,
    joined: Date,
    minutes: number[]
}

export type Song = {
    name: string,
    minutes: number[]
}

export type Data = {
    participants: Chorister[],
    songs: Song[],
    rehersals: Date[]
}

// Assuming the date format is DD.MM.YY
function parse_date(date: string): Date {
    const parts = date.split('.');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are zero-indexed in JS
    const year = parseInt(parts[2], 10) + 2000; // Assuming the year is in the 2000s
    return new Date(year, month, day);
}

export function load_data(file: string): Data {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.split('\n');
    const header = lines[0];

    const [,, ...dates] = header.split(',');

    const result = {
        rehersals: dates.map(parse_date),
        participants: [],
        songs: []
    } as Data;
    
    lines.slice(1).forEach((line) => {
        const vocal = line.split(',')[0];
        if (vocal.toLowerCase() === "song") {
            const [_, name, ...minutes] = line.split(',');
            result.songs.push({
                name,
                minutes: minutes.map((minutes) => parseInt(minutes) ?? 0)
            });
        } else {
            const [_, chorister, joined, ...hours] = line.split(',');
            const [name, surname] = chorister.split(' ');
            result.participants.push({
                vocal,
                name,
                surname,
                joined: parse_date(joined),
                minutes: hours.map(h => 60 * parseInt(h) ?? 0)
            });
        }
    });

    return result;
}