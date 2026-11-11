import { IJournal, JournalFields, JournalLevel } from "@src/interfaces/journal.js";

export type MemoryJournalRecord = {
    readonly level: JournalLevel;
    readonly message: string;
    readonly component: string;
    readonly fields: JournalFields;
}

export class MemoryJournal implements IJournal {
    private history: MemoryJournalRecord[] = [];
    private component: string[] = [];
    private bindings: JournalFields = {};

    get records(): readonly MemoryJournalRecord[] {
        return this.history.map(record => ({ ...record, fields: Helpers.copy_fields(record.fields) }));
    }

    clear(): void {
        this.history.length = 0;
    }

    info(message: string): void;
    info(fields: JournalFields, message: string): void;
    info(fields: string | JournalFields, message?: string): void {
        this.record("info", fields, message);
    }

    error(message: string): void;
    error(fields: JournalFields, message: string): void;
    error(fields: string | JournalFields, message?: string): void {
        this.record("error", fields, message);
    }

    debug(message: string): void;
    debug(fields: JournalFields, message: string): void;
    debug(fields: string | JournalFields, message?: string): void {
        this.record("debug", fields, message);
    }

    warning(message: string): void;
    warning(fields: JournalFields, message: string): void;
    warning(fields: string | JournalFields, message?: string): void {
        this.record("warning", fields, message);
    }

    child(component: string, bindings: JournalFields = {}): IJournal {
        const child = new MemoryJournal();
        child.history = this.history;
        child.component = [...this.component, component];
        child.bindings = Helpers.copy_fields({ ...this.bindings, ...bindings });
        return child;
    }

    private record(level: JournalLevel, fields: string | JournalFields, message?: string): void {
        this.history.push({
            level,
            message: typeof fields === "string" ? fields : message ?? "",
            component: this.component.join("."),
            fields: Helpers.copy_fields({ ...this.bindings,
                ...(typeof fields === "string" ? {} : fields) }),
        });
    }
}

class Helpers {
    static copy_fields(fields: JournalFields): JournalFields {
        const seen = new Map<object, unknown>();
        return Object.fromEntries(Object.entries(fields).map(([key, value]) =>
            [key, Helpers.copy(value, seen)]));
    }

    private static copy(value: unknown, seen: Map<object, unknown>): unknown {
        if (typeof value === "function") return String(value);
        if (value === null || typeof value !== "object") return value;
        if (seen.has(value)) return seen.get(value);
        if (value instanceof Date) return new Date(value);
        if (value instanceof RegExp) return new RegExp(value);
        if (value instanceof Map) {
            const source: ReadonlyMap<unknown, unknown> = value;
            const result = new Map<unknown, unknown>();
            seen.set(value, result);
            for (const [key, item] of source) {
                result.set(Helpers.copy(key, seen), Helpers.copy(item, seen));
            }
            return result;
        }
        if (value instanceof Set) {
            const source: ReadonlySet<unknown> = value;
            const result = new Set<unknown>();
            seen.set(value, result);
            for (const item of source) result.add(Helpers.copy(item, seen));
            return result;
        }
        if (Array.isArray(value)) {
            const source: readonly unknown[] = value;
            const result: unknown[] = [];
            seen.set(value, result);
            for (const item of source) result.push(Helpers.copy(item, seen));
            return result;
        }
        const result: Record<string, unknown> = {};
        seen.set(value, result);
        if (value instanceof Error) {
            result.name = value.name;
            result.message = value.message;
            result.stack = value.stack;
            if ("cause" in value) result.cause = Helpers.copy(value.cause, seen);
        }
        const entries: [string, unknown][] = Object.entries(value);
        for (const [key, item] of entries) {
            Object.defineProperty(result, key, {
                value: Helpers.copy(item, seen), enumerable: true, writable: true,
                configurable: true,
            });
        }
        return result;
    }
}
