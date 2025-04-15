import { Status } from "@src/status.js";

export type RehersalInfo = {
    date: Date;
    songs: {
        name: string;
        minutes: number
    }[];
    participants: {
        tgid: string;
        minutes: number
    }[];
};

export interface IRehersalsStorage {

    init(): Promise<Status>;

    get_rehersals(): RehersalInfo[];

}