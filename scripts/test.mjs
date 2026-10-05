import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? collect(`${directory}/${e.name}`) : e.name.endsWith(".test.ts") ? [`${directory}/${e.name}`] : []))).flat();
}
const files = (await collect("tests")).sort();
if (!files.length) throw new Error("No test files found.");
const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit", env: process.env });
child.on("exit", code => { process.exitCode = code ?? 1; });
