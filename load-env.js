// load-env.js - CommonJS module that loads .env synchronously before ES modules evaluate
const fs = require('fs');
const path = require('path');

const envFile = path.join(process.cwd(), '.env');
if (!process.env.VERCEL && fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
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