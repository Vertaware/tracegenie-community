import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const command = process.argv[2] ?? "start";
const local = path.join(root, ".local");
fs.mkdirSync(local, { recursive: true });
const envPath = path.join(root, ".env");
if (command !== "stop") {
  const { initializeLocalEnvironment } = await import("./local-env.mjs");
  initializeLocalEnvironment(root);
}
const { config } = await import("dotenv"); config({ path: envPath, override: true });
function run(bin,args) { const p=spawnSync(bin,args,{cwd:root,env:process.env,stdio:"inherit"});if(p.status!==0)throw new Error(`${bin} failed (${p.status})`); }
const npm=process.platform === "win32" ? "npm.cmd" : "npm";
if(command === "stop") {
  const state=fs.existsSync(path.join(local,"processes.json")) ? JSON.parse(fs.readFileSync(path.join(local,"processes.json"),"utf8")) : [];
  for(const item of state) {
    const observed=spawnSync("ps",["-p",String(item.pid),"-o","command="],{encoding:"utf8"}).stdout?.trim();
    if(observed && observed.includes(root) && observed.includes(item.marker)) process.kill(item.pid,"SIGTERM");
  }
  run("docker",["compose","stop"]);process.exit(0);
}
if (command === "start" && fs.existsSync(path.join(local,"processes.json"))) {
  const recorded = JSON.parse(fs.readFileSync(path.join(local,"processes.json"),"utf8"));
  const live = recorded.filter(item => {
    const observed = spawnSync("ps",["-p",String(item.pid),"-o","command="],{encoding:"utf8"}).stdout?.trim();
    return observed?.includes(root) && observed.includes(item.marker);
  });
  if (live.length) {
    console.log("Community processes are already running. Use npm run stop before restarting.");
    process.exit(live.length === recorded.length ? 0 : 1);
  }
}
run("docker",["compose","up","-d","--wait"]);
run(npm,["run","db:generate"]);
run(npm,["run","db:migrate"]);
run(process.execPath,["--import","tsx","scripts/seed-community.ts"]);
if(command === "setup") { console.log("Local setup ready. Login is in .local/login.txt.");process.exit(0); }
run(npm,["run","build"]);
const services = [
  ["api", "apps/api/dist/server.js", [path.join(root,"apps/api/dist/server.js")]],
  ["worker", "apps/api/dist/worker.js", [path.join(root,"apps/api/dist/worker.js")]],
  ["admin", "apps/admin", [path.join(root,"node_modules/vite/bin/vite.js"),"apps/admin","--host","127.0.0.1","--port","4311","--strictPort"]],
  ["widget", "apps/demo", [path.join(root,"node_modules/vite/bin/vite.js"),"apps/demo","--host","127.0.0.1","--port","4312","--strictPort"]],
];
const processes=[];
for(const [name,marker,args] of services) {
  const log=fs.openSync(path.join(local,`${name}.log`),"a");
  const child=spawn(process.execPath,args,{cwd:root,env:process.env,detached:true,stdio:["ignore",log,log]});
  child.unref();processes.push({name,pid:child.pid,marker});
}
fs.writeFileSync(path.join(local,"processes.json"),JSON.stringify(processes,null,2));
try {
  for (const url of [`${process.env.API_BASE_URL}/ready`, process.env.ADMIN_APP_URL, process.env.DEMO_APP_URL]) {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(response => response.ok).catch(() => false);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error(`Service did not become ready: ${url}. Check .local logs.`);
  }
  for (const child of processes) process.kill(child.pid, 0);
} catch (error) {
  for (const child of processes) { try { process.kill(child.pid, "SIGTERM"); } catch {} }
  throw error;
}
console.log("Community: http://127.0.0.1:4311  Widget: http://127.0.0.1:4312/?projectKey=community&mode=feedback\nLocal login: .local/login.txt  Local email: http://127.0.0.1:14325");
