import { IDepositService } from "./deposit_service.js";
import { IScoresService } from "./scores_service.js";
import { ISimpleMemoryService } from "./simple_memory_service.js";
import { ITaskTrackerService } from "./task_tracker_service.js";
import { IUserService } from "./user_service.js";


export interface IEnvironment {

    get user_service(): IUserService;
    get maybe_user_service(): IUserService | undefined;

    get task_tracker_service(): ITaskTrackerService;
    get maybe_task_tracker_service(): ITaskTrackerService | undefined;

    get simple_memory_service(): ISimpleMemoryService;
    get maybe_simple_memory_service(): ISimpleMemoryService | undefined;

    get deposit_service(): IDepositService;
    get maybe_deposit_service(): IDepositService | undefined;

    get scores_service(): IScoresService;
    get maybe_scores_service(): IScoresService | undefined;

}
