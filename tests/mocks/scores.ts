import { IScoresService } from "@src/interfaces/scores_service.js";

import { unexpected } from "./unexpected.js";

export function mock_scores(overrides: Partial<IScoresService> = {}): IScoresService {
    return {
        fetch_all: unexpected,
        get: unexpected,
        search: unexpected,
        ...overrides,
    };
}
