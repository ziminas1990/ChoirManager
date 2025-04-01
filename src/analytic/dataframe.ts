
class Dataframe<T> {
    public records: T[] = [];

    with<K extends keyof T>(what: K, value: T[K]): Dataframe<T> {
        const result = new Dataframe<T>();
        result.records = this.records.filter(record => record[what] === value);
        return result;
    }

    filter(predicate: (record: T) => boolean): Dataframe<T> {
        const result = new Dataframe<T>();
        result.records = this.records.filter(predicate);
        return result;
    }

    map<U>(mapper: (record: T) => U): Dataframe<U> {
        const result = new Dataframe<U>();
        result.records = this.records.map(mapper);
        return result;
    }
}