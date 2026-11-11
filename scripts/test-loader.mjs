import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { transform } from "esbuild";

const root = new URL("../", import.meta.url);
const tsconfigRaw = await readFile(new URL("tsconfig.json", root), "utf8");

export async function resolve(specifier, context, nextResolve) {
    let url;
    for (const [alias, directory] of [["@src/", "src/"], ["@tests/", "tests/"]]) {
        if (specifier.startsWith(alias)) {
            url = new URL(directory + specifier.slice(alias.length), root);
            break;
        }
    }
    if (!url && specifier.startsWith(".") && context.parentURL) {
        url = new URL(specifier, context.parentURL);
    }
    // Source imports retain .js extensions for the production build.
    const localSource = url && ["src/", "tests/"].some(directory =>
        url.href.startsWith(new URL(directory, root).href));
    if (localSource && url.pathname.endsWith(".js")) {
        const filename = fileURLToPath(url).slice(0, -3) + ".ts";
        if (existsSync(filename)) {
            return { url: pathToFileURL(resolvePath(filename)).href, shortCircuit: true };
        }
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
        const filename = fileURLToPath(url);
        const { code } = await transform(await readFile(filename, "utf8"), {
            loader: "ts", format: "esm", target: "node18", tsconfigRaw,
            sourcemap: "inline", sourcefile: filename,
        });
        return { format: "module", source: code, shortCircuit: true };
    }
    return nextLoad(url, context);
}
