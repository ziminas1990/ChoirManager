import { Database, Rehersal } from "@src/database.js";

export function mock_database(overrides: Partial<Database>): Database {
    return Object.assign(new Database(), overrides);
}

export function mock_rehersal(overrides: Partial<Rehersal>): Rehersal {
    return Object.assign(new Rehersal(new Database(), {
        rehersal_id: 1, date: new Date(0), duration_minutes: new Map(),
    }), overrides);
}
