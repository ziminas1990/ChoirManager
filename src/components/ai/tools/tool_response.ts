import { Expected, Status } from "@src/utils/expected.js";

type ValueOrError<T> = {
    value?: T;
    error?: string;
}

export function return_success<T>(value: T): string {
    return JSON.stringify({ value } as ValueOrError<T>);
}

export function return_error(error: string): string {
    return JSON.stringify({ error } as ValueOrError<never>);
}

export function status_to_expected<T>(status: Status, value: T): Expected<T> {
    return status.ok
        ? Expected.ok(value)
        : Expected.err(status.error);
}
