import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function discover(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(entry => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? discover(path)
            : entry.name.endsWith(".test.ts") ? [path] : [];
    }));
    return files.flat().sort();
}

const selected = process.argv.slice(2);
const files = selected.length ? selected : await discover(resolve(root, "tests"));
const result = spawnSync(process.execPath, [
    "--import", "./scripts/register-tests.mjs", "--test", ...files,
], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
