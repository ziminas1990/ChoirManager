import pino from "pino";
import { Status } from "@src/status.js";

export type PackedMap<K, P> = [K, P][];

export function pack_map<K, V, P>(map: Map<K, V>, packer: (value: V) => P): PackedMap<K, P> {
    return Array.from(map.entries()).map(([key, value]) => [key, packer(value)]);
}

export function unpack_map<K, V, P>(map: PackedMap<K, P>, unpacker: (packed: P) => V | undefined): Map<K, V> {
    const items = map.map(([key, packed]) => [key, unpacker(packed)] as const)
        .filter(([_, value]) => value != undefined) as [K, V][];
    return new Map(items);
}

export function seconds_since(date: Date): number {
    return (new Date().getTime() - date.getTime()) / 1000;
}

// Applies the specified 'interval' to the specified 'date' inplace(!). Return 'date'
// object.
export function apply_interval(
    date: Date, interval: { months?: number; milliseconds?: number; seconds?: number }): Date
{
    if (interval.months) {
        date.setMonth(date.getMonth() + interval.months);
    }

    if (interval.milliseconds) {
        date.setMilliseconds(date.getMilliseconds() + interval.milliseconds);
    }

    if (interval.seconds) {
        date.setSeconds(date.getSeconds() + interval.seconds);
    }

    return date;
}

export function split_to_columns<T>(list: T[], columns: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < list.length; i += columns) {
        result.push(list.slice(i, i + columns));
    }
    return result;
}

export function return_fail(what: string, logger: pino.Logger): Status {
    logger.error(what);
    return Status.fail(what);
}

export function return_exception(error: unknown, logger: pino.Logger, wrap?: string): Status {
    logger.error(error);
    if (wrap) {
        return Status.exception(error).wrap(wrap);
    }
    return Status.exception(error);
}

export function only_month(date: Date): Date {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth()));
}

export function current_month(): Date {
    return only_month(new Date());
}

export function next_month(): Date {
    const current = current_month();
    return new Date(Date.UTC(current.getFullYear(), current.getMonth() + 1));
}

export type Formatting = "markdown" | "html" | "plain";

export class Formatter {

    private static formatting: Formatting = "plain";

    constructor(formatting: Formatting) {
        Formatter.formatting = formatting;
    }

    do_nothing() {}

    bold(text: string): string {
        switch (Formatter.formatting) {
            case "markdown": return `**${text}**`;
            case "html": return `<b>${text}</b>`;
            default: return text;
        }
    }

    italic(text: string): string {
        switch (Formatter.formatting) {
            case "markdown": return `*${text}*`;
            case "html": return `<i>${text}</i>`;
            default: return text;
        }
    }

    copiable(text: string): string {
        switch (Formatter.formatting) {
            case "markdown": return `\`\`\`${text}\`\`\``;
            case "html": return `<code>${text}</code>`;
            default: return text;
        }
    }

    quote(text: string): string {
        switch (Formatter.formatting) {
            case "markdown": return `> ${text}`;
            case "html": return `<blockquote>${text}</blockquote>`;
            default: return text;
        }
    }
}

export class GlobalFormatter extends Formatter {
    static _instance: GlobalFormatter;

    private constructor(formatting: Formatting) {
        super(formatting);
    }

    static init(formatting: Formatting): void {
        if (GlobalFormatter._instance) {
            throw new Error("GlobalFormatter already initialized");
        }
        GlobalFormatter._instance = new GlobalFormatter(formatting);
    }

    static instance(): GlobalFormatter {
        if (!GlobalFormatter._instance) {
            throw new Error("GlobalFormatter not initialized");
        }
        return GlobalFormatter._instance;
    }
}
