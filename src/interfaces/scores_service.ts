import { Score } from "@src/entities/score.js";
import { Expected } from "@src/utils/expected.js";

// Service logic: caching and AI search over the scores catalog.
// Always async — designed for local or remote implementations.
export interface IScoresService {
    // Catalog from cache (all entries). Callers apply filters / ACL.
    fetch_all(): Promise<Score[]>;

    // Exact resolve by stable key for download / lookup.
    get(key: string): Promise<Expected<Score | undefined>>;

    // AI search over the cached catalog; returns matching Score entities.
    search(query: string): Promise<Expected<Score[]>>;
}
