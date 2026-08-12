import { Score } from "@src/entities/score.js";
import { Expected } from "@src/utils/expected.js";

// Pure persistence: parse and return scores from the backend.
export interface IScoresStorage {
    fetch_all(): Promise<Expected<Score[]>>;
}
