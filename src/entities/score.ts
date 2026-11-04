import { createHash } from "crypto";

// A catalog entry for sheet music (scores).
export class Score {
    constructor(
        public readonly name: string,
        public readonly author: string,
        public readonly hints: string,
        public readonly duration: number,
        public readonly file?: string,
    ) {}

    // Stable map key used by ScoresService cache and Database historically.
    public get_key(): string {
        return `${this.name} by ${this.author}`;
    }

    // Compact, deterministic identity; independent of file links and catalog order.
    public get_id(): string {
        return createHash("sha256").update(this.get_key()).digest("base64url");
    }
}
