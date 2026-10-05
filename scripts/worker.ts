import { workerTick } from "../src/server/worker";
import { db } from "../src/server/db";
let stopping=false;
process.on("SIGTERM",()=>{stopping=true;}); process.on("SIGINT",()=>{stopping=true;});
do {
  try { await workerTick(); console.log("Worker scan completed."); }
  catch { console.error("Worker scan blocked; check configuration/provider availability. Private inputs are not logged."); }
  if(process.argv.includes("--once")) break;
  if(!stopping) await new Promise(resolve=>setTimeout(resolve,15000));
} while(!stopping);
await db().end();
