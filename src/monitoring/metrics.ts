import { createHash } from "crypto";

// tags_hash -> [tags, value]
export type MetricType = "counter" | "gauge";
type Tags = { [key: string]: string | undefined };
type Metric = {
    type: "value",
    value: number,
} | {
    type: "callback",
    callback: () => number,
}
type TaggedMetrics = [MetricType, Map<string, [Tags, Metric]>];

function empty_value(): Metric {
    return { type: "value", value: 0 };
}

// NOTE: quite inefficient implementation!
function hash_for_tags(tags: Tags): string {
    const entries = Object.entries(tags);
    const sorted_entries = entries
        .filter(([_, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
    if (sorted_entries.length === 0) {
        return "";
    }
    const jsonString = JSON.stringify(Object.fromEntries(sorted_entries));
    return createHash("sha256").update(jsonString).digest("hex");
}

export class Metrics {
    // name -> tags -> metric (value or callback)
    private static metrics: Map<string, TaggedMetrics> = new Map();

    public static inc(name: string, tags?: Tags, value: number = 1) {
        let metric = this.metrics.get(name);
        if (!metric) {
            metric = ["counter", new Map<string, [Tags, Metric]>()];
            this.metrics.set(name, metric);
        }

        const [metric_type, metric_by_tags] = metric;
        if (metric_type !== "counter") {
            throw new Error(`Metric ${name} is not a counter`);
        }

        const tags_hash = hash_for_tags(tags ?? {});
        let tagged_metric = metric_by_tags.get(tags_hash);
        if (!tagged_metric) {
            tagged_metric = [tags ?? {}, empty_value()];
            metric_by_tags.set(tags_hash, tagged_metric);
        }

        const metric_value = tagged_metric[1];
        if (metric_value.type !== "value") {
            throw new Error(`Metric ${name} is not a value`);
        }
        metric_value.value += value;
    }

    public static set(name: string, value: number, tags?: Tags) {
        let metric = this.metrics.get(name);
        if (!metric) {
            metric = ["gauge", new Map<string, [Tags, Metric]>()];
            this.metrics.set(name, metric);
        }

        const [metric_type, metric_by_tags] = metric;
        if (metric_type !== "gauge") {
            throw new Error(`Metric ${name} is not a gauge`);
        }

        const tags_hash = hash_for_tags(tags ?? {});
        let tagged_metric = metric_by_tags.get(tags_hash);
        if (!tagged_metric) {
            tagged_metric = [tags ?? {}, empty_value()];
            metric_by_tags.set(tags_hash, tagged_metric);
        }

        const metric_value = tagged_metric[1];
        if (metric_value.type !== "value") {
            throw new Error(`Metric ${name} is not a value`);
        }
        metric_value.value = value;
    }

    public static set_callback(name: string, callback: () => number, tags?: Tags) {
        let metric = this.metrics.get(name);
        if (!metric) {
            metric = ["gauge", new Map<string, [Tags, Metric]>()];
            this.metrics.set(name, metric);
        }

        const [metric_type, metric_by_tags] = metric;
        if (metric_type !== "gauge") {
            throw new Error(`Can't set callback for metric ${name}, it's not a gauge`);
        }

        const tags_hash = hash_for_tags(tags ?? {});
        if (metric_by_tags.has(tags_hash)) {
            throw new Error(
                `Callback for metric ${name} already set for tags ${JSON.stringify(tags)}`);
        }
        metric_by_tags.set(tags_hash, [tags ?? {}, { type: "callback", callback }]);
    }

    public static remove_metric(name: string, tags?: Tags) {
        const tags_hash = hash_for_tags(tags ?? {});
        const tagged_metric = this.metrics.get(name);
        if (!tagged_metric) {
            return;
        }
        tagged_metric[1].delete(tags_hash);
    }

    public static reset() {
        this.metrics.clear();
    }

    public static prometheus_metrics(): string {
        const metrics = [];
        const names = [...this.metrics.keys()].sort((a, b) => a.localeCompare(b));

        for (const name of names) {
            const metric = this.metrics.get(name);
            if (!metric) {
                continue;
            }
            const [metric_type, metric_by_tags] = metric;

            // Handle counter and gauge metrics
            metrics.push(`# TYPE ${name} ${metric_type}`);
            for (const [_, [tags, metric_obj]] of metric_by_tags) {
                const tags_entries = Object.entries(tags);
                const tags_string = tags_entries.length === 0
                    ? ""
                    : `{${tags_entries.map(([key, value]) => `${key}="${value}"`).join(",")}}`;
                const value = metric_obj.type === "value" ? metric_obj.value : metric_obj.callback();
                metrics.push(`${name}${tags_string} ${value}`);
            }
        }

        // Add total metrics count at the end
        {
            const total_tagged_metrics = [...this.metrics.values()]
                .reduce((sum, [_, metric_by_tags]) =>
                    sum + metric_by_tags.size,
                0);

            metrics.push("# TYPE metrics_total_count gauge");
            metrics.push(`metrics_total_count ${total_tagged_metrics}`);
        }

        return metrics.join("\n");
    }
}
