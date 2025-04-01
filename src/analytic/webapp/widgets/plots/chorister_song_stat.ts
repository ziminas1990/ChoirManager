// import { ChoristerId } from "src/data_model";
// import { BaseWidget, BaseWidgetState } from "../base_widget";

// export type ChoristerSongStatWidgetState = BaseWidgetState & {
//     interval: [Date, Date]
//     choristers: ChoristerId[]
// }

// export class ChoristerSongStatWidget extends BaseWidget<ChoristerSongStatWidgetState> {
//     static unique_name: string = "ChoristerSongStatWidget";

//     constructor(frame: HTMLDivElement, private state: ChoristerSongStatWidgetState)
//     {
//         super(frame, ChoristerSongStatWidget.unique_name)
//     }

//     store(): ChoristerSongStatWidgetState {
//         return this.state;
//     }
// }