import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluatorKeyHash, generateEvaluatorKeys } from "../src/lib/encryption";
const directory = resolve(process.argv[2] ?? ".secrets");
await mkdir(directory, { recursive: true, mode: 0o700 });
const keys = await generateEvaluatorKeys();
// wx refuses to overwrite keys for existing auctions.
await writeFile(resolve(directory, "evaluator-private.jwk.json"), JSON.stringify(keys.privateKey, null, 2), { mode: 0o600, flag: "wx" });
await writeFile(resolve(directory, "evaluator-public.jwk.json"), JSON.stringify(keys.publicKey, null, 2), { mode: 0o644, flag: "wx" });
console.log(`Evaluator JWK files written to ${directory}. Private file mode: 0600. Keep outside the web deployment.`);
console.log(`Public evaluator key hash: ${evaluatorKeyHash(keys.publicKey)}`);
