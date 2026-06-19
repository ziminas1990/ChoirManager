
type TokenBucketConfig = {
    max_tokens: number;
    refill_rate: number;
}

type PendingOperation = {
    tokens: number;
    resolve: (value: void) => void;
}

export class TokenBucket {

    private tokens: number;
    private last_update: number;
    private pending_operations: PendingOperation[] = [];


    constructor(private readonly config: TokenBucketConfig)
    {
        if (config.max_tokens <= 0) {
            throw new Error("Max tokens must be greater than 0");
        }
        if (config.refill_rate <= 0) {
            throw new Error("Refill rate must be greater than 0");
        }
        this.tokens = config.max_tokens;
        this.last_update = Date.now();
    }

    consume(tokens: number, now: Date = new Date()): boolean {
        if (tokens <= 0) {
            return true;
        }
        if (this.pending_operations.length > 0) {
            // If there are pending operations, we should not consume tokens
            return false;
        }
        return this.do_consume(tokens, now);
    }

    wait_tokens(tokens: number, now: Date = new Date()): Promise<void> {
        if (tokens <= 0) {
            return Promise.resolve();
        }
        if (tokens > this.config.max_tokens) {
            throw new Error("Requested more tokens than the bucket can hold");
        }
        if (this.consume(tokens, now)) {
            return Promise.resolve();
        }
        return this.add_pending_operation(tokens);
    }

    private update(now: Date = new Date()): void {
        const time_since_last_update = Math.max(0, now.getTime() - this.last_update);
        const tokens_to_add = time_since_last_update * this.config.refill_rate / 1000;
        this.tokens = Math.min(this.tokens + tokens_to_add, this.config.max_tokens);
        this.last_update = now.getTime();
    }

    private add_pending_operation(tokens: number): Promise<void> {
        const pending_operation: PendingOperation = {
            tokens: tokens,
            resolve: () => {},
        };
        this.pending_operations.push(pending_operation);

        const pending_promise = new Promise<void>((resolve) => {
            pending_operation.resolve = resolve;
        });

        if (this.pending_operations.length === 1) {
            // Since there were no pending operations before, we should start a loop
            // that will consume tokens as long as there are pending operations
            new Promise<void>(async (resolve) => {
                while (this.pending_operations.length > 0) {
                    const pending = this.pending_operations[0];
                    if (this.do_consume(pending.tokens, new Date())) {
                        this.pending_operations.shift();
                        pending.resolve();
                        continue;
                    }

                    const time_to_wait = (pending.tokens - this.tokens) * 1000 / this.config.refill_rate;
                    await new Promise(resolve => setTimeout(resolve, time_to_wait));
                }
                resolve();
            });
        }

        return pending_promise;
    }

    private do_consume(tokens: number, now: Date): boolean {
        this.update(now);
        if (tokens > this.tokens) {
            return false;
        }
        this.tokens -= tokens;
        return true;
    }
}
