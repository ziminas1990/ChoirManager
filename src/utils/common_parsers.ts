import { Expected } from "@src/utils/expected.js";

export function parse_datetime(value: string): Date | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }

    const match = trimmed.match(
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (!match) {
        const fallback = new Date(trimmed);
        if (Number.isNaN(fallback.getTime())) {
            return undefined;
        }
        return fallback;
    }

    const [
        ,
        day_str,
        month_str,
        year_str,
        hour_str = "0",
        minute_str = "0",
        second_str = "0",
    ] = match;

    const day = parseInt(day_str, 10);
    const month = parseInt(month_str, 10) - 1;
    const year = parseInt(year_str, 10);
    const hour = parseInt(hour_str, 10);
    const minute = parseInt(minute_str, 10);
    const second = parseInt(second_str, 10);

    const date = new Date(year, month, day, hour, minute, second);
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute ||
        date.getSeconds() !== second
    ) {
        return undefined;
    }

    return date;
}

export function parse_optional_datetime(value: string | null | undefined, field: string): Expected<Date | undefined> {
    if (value === undefined) {
        return Expected.ok(undefined);
    }
    if (value === null) {
        return Expected.ok(undefined);
    }

    const parsed = parse_datetime(value);
    if (!parsed) {
        return Expected.err(`invalid ${field} value '${value}'`);
    }
    return Expected.ok(parsed);
}
