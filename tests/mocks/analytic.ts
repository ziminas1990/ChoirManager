import { IAnalyticService } from "@src/interfaces/analytic_service.js";

import { unexpected } from "./unexpected.js";

export function mock_analytic(overrides: Partial<IAnalyticService> = {}): IAnalyticService {
    return {
        chorister_statistic_request: unexpected,
        choristers_activity: unexpected,
        build_attendance_report: unexpected,
        build_monthly_attendance_report: unexpected,
        ...overrides,
    };
}
