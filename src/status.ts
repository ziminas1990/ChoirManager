
export class Status {
    // Problem that occured during the operation that prevented it from completing
    private error?: {
        details: string;
        nested?: Status;
    };
    // Problems that occured during the operation but didn't prevent it from completing
    private warn?: {
        details: string;
        nested: Status[];
    };

    static ok(): Status {
        return new Status();
    }

    static fail(details: string, nested?: Status): Status {
        const status = new Status();
        status.error = { details, nested };
        return status;
    }

    static warning(details: string, warnings: Status[]): Status {
        const status = new Status();
        status.warn = { details, nested: warnings };
        return status;
    }

    // Check if operation is completed (even if there were warnings)
    public done(): boolean { return this.error == undefined; }

    // Check if no errors occured and no warnings occured
    public ok(): boolean { return this.error == undefined && this.warn == undefined; }

    public wrap(operation: string): Status {
        if (this.error) {
            return Status.fail(operation, this);
        }
        if (this.warn) {
            return Status.warning(operation, [this]);
        }
        return Status.ok();
    }

    public what(indent: string = "", max_warnings: number = 5): string {
        if (this.error) {
            return [
                `${indent}${this.error.details}`,
                this.error.nested ? this.error.nested.what(indent + "  ") : undefined
            ].filter(e => e).join(": ");
        }
        if (this.warn) {
            return [
                `${indent}${this.warn.details}`,
                ...this.warn.nested.slice(0, max_warnings).map(w => w.what(indent + "  "))
            ].filter(e => e.trim()).join("\n");
        }
        return "ok";
    }

    public with<T>(value: T | undefined): StatusWith<T> {
        (this as any).value = value;
        return this as StatusWith<T>;
    }

    static fold_as_warnings(action: string, statuses: Status[]): Status {
        if (statuses.length == 0) {
            return Status.ok();
        }
        return Status.warning(action, statuses);
    }
}

export class StatusWith<T> extends Status {
    value?: T;
}