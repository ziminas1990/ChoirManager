
export class Status {
    private error?: string;
    private nested?: Status

    static ok(): Status {
        return new Status(undefined);
    }

    static fail(details: string): Status {
        return new Status(details);
    }

    protected constructor(error: string | undefined) {
        this.error = error;
    }

    public wrap(error: string): Status {
        const fail = Status.fail(error);
        if (!this.is_ok()) {
            fail.nested = this;
        }
        return fail;
    }

    public wrap_if_fail(error: string): Status {
        return this.is_ok() ? this : this.wrap(error);
    }

    public what(): string {
        if (this.is_ok()) {
            return "ok";
        }
        return [
            this.error,
            this.nested ? this.nested.what() : undefined
        ].filter(e => e).join(": ");
    }

    public with<T>(value: T | undefined): StatusWith<T> {
        (this as any).value = value;
        return this as StatusWith<T>;
    }

    public is_ok(): boolean { return this.error == undefined; }
}

export class StatusWith<T> extends Status {
    value?: T;
}