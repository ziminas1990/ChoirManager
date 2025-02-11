import * as fs from 'fs';
import { Data } from './types.js';
import { parse_raw_data } from './parse_raw_data.js';
import { Table } from './google_spreadsheet.js';
import { StatusWith } from '../status.js';

export function load_data(file: string): StatusWith<Data> {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.split('\n');
    const table: Table = lines.map(line => line.split(','));
    return StatusWith.ok().with(parse_raw_data(table));
}