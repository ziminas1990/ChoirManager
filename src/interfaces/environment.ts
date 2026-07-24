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

}
