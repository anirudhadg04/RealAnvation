// server-entry.mjs - Load .env, then spawn the actual server
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env synchronously before spawning server
const envFile = join(process.cwd(), '.env');
if (!process.env.VERCEL && existsSync(envFile)) {
  for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
  console.log('[ENV] Loaded configuration from .env (SMTP ready if configured).');
} else {
  console.log('[ENV] No .env file found — SMTP email delivery will fall back to .eml generation.');
}

// Spawn the actual server with the environment already loaded
const server = spawn('npx.cmd', ['tsx', 'server.ts'], {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(),
  shell: true,
});

server.on('error', (err) => {
  console.error('[SPAWN ERROR]', err);
  process.exit(1);
});

server.on('exit', (code) => {
  console.log(`[SERVER] Exited with code ${code}`);
  process.exit(code || 0);
});

process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));