#!/usr/bin/env node
// Explicit, opt-in synthetic Alertmanager delivery drill. Never called by CI.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseDrillArgs(args) {
  let origin;
  let send = false;
  let acknowledge = false;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error('Duplicate drill argument');
    seen.add(arg);
    if (arg === '--origin') {
      if (typeof args[i + 1] !== 'string') throw new Error('Missing drill origin');
      origin = args[++i];
    } else if (arg === '--send') send = true;
    else if (arg === '--acknowledge-test-route') acknowledge = true;
    else throw new Error('Unknown drill argument');
  }
  if (send !== acknowledge) throw new Error('Drill requires explicit opt-in');
  if (send && !origin) throw new Error('Drill origin required for delivery');
  return { origin: origin ? validateOrigin(origin) : null, send };
}

export function validateOrigin(input) {
  let url;
  try { url = new URL(input); }
  catch { throw new Error('Invalid Alertmanager origin'); }
  if ((url.protocol !== 'https:' &&
       !(url.protocol === 'http:' &&
         ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || url.origin === 'null') {
    throw new Error('Invalid Alertmanager origin');
  }
  return url.origin;
}

export function drillAlert(nowMs = Date.now(), drillId) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('Invalid drill time');
  }
  if (drillId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(drillId)) {
    throw new Error('Invalid synthetic drill identifier');
  }
  const alert = {
    labels: {
      alertname: 'GymApiMonitoringDeliveryDrill',
      severity: 'warning',
      drill: 'true',
      source: 'gym-api-monitoring',
    },
    annotations: { summary: 'Authorized synthetic monitoring notification drill' },
    startsAt: new Date(nowMs).toISOString(),
    endsAt: new Date(nowMs + 180_000).toISOString(),
  };
  if (drillId !== undefined) {
    alert.labels.drill_id = drillId;
    alert.annotations.summary += ' [' + drillId + ']';
  }
  return [alert];
}

export async function deliverDrill(origin, nowMs = Date.now(), fetchFn = fetch, drillId) {
  const base = validateOrigin(origin);
  const body = JSON.stringify(drillAlert(nowMs, drillId));
  let response;
  try {
    response = await fetchFn(new URL('/api/v2/alerts', base), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error('Alertmanager drill delivery failed');
  }
  if (response.status !== 200 && response.status !== 202) {
    throw new Error('Alertmanager drill was not accepted');
  }
  // A 2xx response confirms API acceptance, not delivery to a human.
  return {
    submitted: true,
    notificationConfirmed: false,
    ...(drillId !== undefined ? { drillId } : {}),
  };
}

async function main() {
  try {
    const { origin, send } = parseDrillArgs(process.argv.slice(2));
    const result = send
      ? await deliverDrill(origin, Date.now(), fetch, randomUUID())
      : { submitted: false, notificationConfirmed: false,
        alert: drillAlert()[0] };
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    // Never echo a URL containing auth or sensitive deployment details.
    process.stderr.write('Alertmanager drill failed: invalid configuration or delivery\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
