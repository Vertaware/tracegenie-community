import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
try {
  if (process.env.TRACEGENIE_MAINTENANCE === '1') throw new Error('Restore maintenance is active');
  const statuses = execFileSync('supervisorctl', ['status'], { encoding: 'utf8', timeout: 2000 });
  if (statuses.trim().split('\n').some(line => !/^\S+\s+RUNNING\s/.test(line))) throw new Error('A supervised service is not running');
  const age = Date.now() - fs.statSync('/tmp/tracegenie-worker-ready').mtimeMs;
  if (age > 60_000) throw new Error('Worker processing heartbeat is stale');
  for (const address of ['http://127.0.0.1:4310/ready', 'http://127.0.0.1:2019/config/']) {
    const response = await fetch(address, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Application or gateway is not ready');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
