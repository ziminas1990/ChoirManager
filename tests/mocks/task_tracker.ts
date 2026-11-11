import { ITaskTrackerService } from "@src/interfaces/task_tracker_service.js";

import { unexpected } from "./unexpected.js";

export function mock_task_tracker(overrides: Partial<ITaskTrackerService> = {}): ITaskTrackerService {
    return {
        fetch: unexpected,
        create: unexpected,
        update: unexpected,
        delete: unexpected,
        ...overrides,
    };
}
