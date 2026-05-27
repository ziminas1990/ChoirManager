import * as fs from 'fs';
import { Expected } from "@src/utils/expected.js";
import { Database } from '@src/analytic/data_model.js';
import { Table, build_data_model } from './data_model_adapter.js';

export function load_csv_data(file: string): Expected<Database> {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.split('\n');
    const table: Table = lines.map(line => line.split(','));
    return build_data_model(table);
}