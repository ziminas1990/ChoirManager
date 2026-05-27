
export type Status = Expected<void>;

export class Expected<T> {
    private constructor(
        private readonly isOk: boolean,
        private readonly val?: T,
        private err?: string,
        private error_code?: number
    ) { }

    static ok<T>(value: T): Expected<T> {
        return new Expected<T>(true, value);
    }

    static err<T = never>(error: string, nested?: Expected<any>): Expected<T> {
        const err = nested ? `${error}: ${nested.error}` : error;
        return new Expected<T>(false, undefined, err);
    }

    static exception<T>(error: string, e: any): Expected<T> {
        const exception_string = e instanceof Error ? e.message : String(e);
        return new Expected<T>(false, undefined, `${error}: ${exception_string}`);
    }

    add_context(context: string): Expected<T> {
        if (!this.isOk) {
            this.err = `${context}: ${this.err ?? "unknown error"}`;
        }
        return this;
    }

    set_error_code(error_code: number): Expected<T> {
        if (!this.isOk) {
            this.error_code = error_code;
        }
        return this;
    }

    is_error(error_code: number | number[]): boolean {
        if (this.isOk) {
            return false;
        }
        if (Array.isArray(error_code)) {
            return error_code.includes(this.error_code ?? 0);
        }
        return this.error_code === error_code;
    }

    wrap_error<U>(details: string): Expected<U> {
        if (this.isOk) {
            throw new Error("tried to wrap_error on a success result");
        }
        return Expected.err(details, this);
    }

    cast_error<U>(): Expected<U> {
        if (this.isOk) {
            throw new Error("tried to cast_error on a success result");
        }
        return this as unknown as Expected<U>;
    }

    with_data<U>(data: U): Expected<U> {
        if (this.isOk) {
            return Expected.ok(data);
        }
        return this as unknown as Expected<U>;
    }

    get ok(): boolean {
        return this.isOk;
    }

    get value(): T {
        if (!this.isOk) {
            throw new Error("Tried to get value from an error result");
        }
        return this.val as T;
    }

    get error(): string {
        if (this.isOk) {
            throw new Error("Tried to get error from a success result");
        }
        return this.err ?? "<unknown error>";
    }
}
