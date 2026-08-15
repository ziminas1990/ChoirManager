
export interface IProceedable {
    proceed(now: Date): Promise<void>;
}
