#!/usr/bin/env node
// Supervisor für bot-hosting.net: startet API, Worker, Bot und Dashboard in einem Deployment,
// startet abgestürzte Dienste mit Backoff neu und beendet alles sauber bei SIGTERM/SIGINT.
// Aufruf (Startbefehl im Panel): bash deploy/bot-hosting/boot.sh
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlanError, missingVariables, planServices, restartDelay } from './services.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** .env im Repository-Wurzelverzeichnis laden (ohne vorhandene Variablen zu überschreiben). */
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(root, '.env'));

const log = (msg) => process.stdout.write(`[enrp] ${new Date().toISOString()} ${msg}\n`);

let plan;
try {
  const missing = missingVariables(process.env);
  if (missing.length) throw new PlanError(`Fehlende Variablen: ${missing.join(', ')} (siehe docs/deployment.md)`);
  plan = planServices(process.env, root);
} catch (err) {
  console.error(`[enrp] ${err.message}`);
  process.exit(1);
}

const children = new Map();
let stopping = false;

function start(service, attempt = 0) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: service.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const startedAt = Date.now();
  children.set(service.name, child);
  const prefix = (stream, target) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line) target.write(`[${service.name}] ${line}\n`);
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('error', (err) => log(`${service.name}: Start fehlgeschlagen (${err.code ?? err.message})`));
  child.on('exit', (code, signal) => {
    children.delete(service.name);
    if (stopping) return;
    // Lief der Dienst länger als 2 Minuten, beginnt der Backoff von vorn.
    const next = Date.now() - startedAt > 120_000 ? 0 : attempt + 1;
    const delay = restartDelay(next);
    log(`${service.name} beendet (Code ${code ?? '-'}, Signal ${signal ?? '-'}) – Neustart in ${delay / 1000} s`);
    setTimeout(() => !stopping && start(service, next), delay);
  });
  log(`${service.name} gestartet (PID ${child.pid})`);
}

function stopAll(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal} empfangen – beende Dienste …`);
  for (const child of children.values()) child.kill('SIGTERM');
  const deadline = setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL');
    process.exit(0);
  }, 25_000);
  const check = setInterval(() => {
    if (children.size === 0) {
      clearInterval(check);
      clearTimeout(deadline);
      process.exit(0);
    }
  }, 200);
}
process.on('SIGTERM', () => stopAll('SIGTERM'));
process.on('SIGINT', () => stopAll('SIGINT'));

// API zuerst (führt Migrationen aus), die übrigen Dienste kurz danach.
const [first, ...rest] = [...plan].sort((a, b) => (a.name === 'api' ? -1 : b.name === 'api' ? 1 : 0));
log(
  `Dienste: ${plan.map((s) => s.name).join(', ')} · öffentlicher Port ${plan.find((s) => s.name === 'dashboard')?.env.PORT ?? '-'}`,
);
start(first);
setTimeout(() => rest.forEach((s) => start(s)), first.name === 'api' ? 5000 : 0);
