import pino from "pino";
import { Expected, Status } from "@src/utils/expected.js";

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
    date: Date,
    interval: {
        months?: number;
        days?: number;
        milliseconds?: number;
        seconds?: number;
    }
): Date {
    if (interval.months) {
        date.setMonth(date.getMonth() + interval.months);
    }

    if (interval.days) {
        date.setDate(date.getDate() + interval.days);
    }

    if (interval.seconds) {
        date.setSeconds(date.getSeconds() + interval.seconds);
    }

    if (interval.milliseconds) {
        date.setMilliseconds(date.getMilliseconds() + interval.milliseconds);
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

export function shorten(text: string, max_length: number): string {
    if (text.length <= max_length) {
        return text;
    }
    return text.slice(0, max_length - 3) + "...";
}

export function return_fail<T = void>(what: string, logger: pino.Logger): Expected<T> {
    logger.error(what);
    return Expected.err(what);
}

export function return_exception<T = void>(error: unknown, logger: pino.Logger, wrap?: string): Expected<T> {
    logger.error(error);
    if (wrap) {
        return Expected.exception(wrap, error);
    }
    return error instanceof Error ? Expected.err(error.message) : Expected.err(String(error));
}

export function log_and_return(status: Status, logger: pino.Logger): Status {
    if (!status.ok) {
        logger.error(status.error);
    }
    return status;
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

    monospace(text: string): string {
        switch (Formatter.formatting) {
            case "markdown": return `\`${text}\``;
            case "html": return `<code>${text}</code>`;
            default: return text;
        }
    }

    preformatted(text: string): string {
        switch (Formatter.formatting) {
            case "markdown": return `\`\`\`${text}\`\`\``;
            case "html": return `<pre>${text}</pre>`;
            default: return text;
        }
    }

    link(text: string, url: string): string {
        switch (Formatter.formatting) {
            case "markdown": return `[${text}](${url})`;
            case "html": return `<a href="${url}">${text}</a>`;
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
