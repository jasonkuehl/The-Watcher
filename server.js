'use strict';

const express = require('express');
const https = require('https');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { spawn } = require('child_process');
const dns = require('dns').promises;
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const CHECK_INTERVAL_MS    = 30 * 1000;  // 30 seconds — HTTP + ping
const SP_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — status page APIs
const MAX_HISTORY = 30;
const REQUEST_TIMEOUT_MS = 5000;

// ─── Load configuration from JSON files ────────────────────────────────────────
const configDir = path.join(__dirname, 'config');
const SITES = JSON.parse(fs.readFileSync(path.join(configDir, 'sites.json'), 'utf8'));
const PORT_CHECKS = JSON.parse(fs.readFileSync(path.join(configDir, 'ports.json'), 'utf8'));
const STATUS_PAGE_APIS = JSON.parse(fs.readFileSync(path.join(configDir, 'status-pages.json'), 'utf8'));

// Map Statuspage.io indicator → our internal label
const SP_INDICATOR = {
  none:        'operational',
  minor:       'degraded',
  major:       'major_outage',
  critical:    'critical',
  maintenance: 'degraded',
};

// ─── In-memory data store ──────────────────────────────────────────────────────
const siteData = {};

SITES.forEach(site => {
  // Derive the human-readable status page URL:
  // - Sites in STATUS_PAGE_APIS: use the origin of the JSON API endpoint
  // - Sites whose URL *is* the status page (e.g. health.aws.amazon.com): use site.url directly
  const spConfig = STATUS_PAGE_APIS[site.host];
  let statusPageUrl = null;
  if (spConfig) {
    try { statusPageUrl = new URL(spConfig.api).origin; } catch {}
  } else if (/status/i.test(site.name) || /status\./i.test(site.host)) {
    statusPageUrl = site.url;
  }

  siteData[site.host] = {
    name:         site.name,
    url:          site.url,
    host:         site.host,
    tags:         spConfig ? ['status-page'] : (site.tags ?? ['http']),
    status:       'unknown',
    statusCode:   null,
    responseTime: null, // ms - full HTTP round trip
    latency:      null, // ms - TCP connect time (time to first byte)
    ping:         null, // ms - ICMP ping
    error:        null,
    lastChecked:  null,
    history:      [],   // last MAX_HISTORY entries
    uptime:       null, // percentage
    // Reported status from the service's own status page API
    reportedStatus:      spConfig?.parser === 'none' ? 'unmonitored' : null,
    reportedDescription: null,
    hasStatusApi:        !!spConfig && spConfig.parser !== 'none',
    statusPageUrl,
    // Incident tracking — set when status transitions into a problem state
    reportedStatusChangedAt: null, // ISO — updated whenever reportedStatus changes to non-operational
    httpStatusChangedAt:     null, // ISO — updated whenever HTTP status changes to 'down'
  };
});

// ─── Port check state ──────────────────────────────────────────────────────────
const portData = {};
PORT_CHECKS.forEach(entry => {
  const key = `${entry.host}:${entry.port}/${entry.protocol}`;
  portData[key] = {
    key,
    name:        entry.name,
    host:        entry.host,
    port:        entry.port,
    protocol:    entry.protocol,
    tags:        [entry.protocol],
    status:      'unknown',
    latency:     null,
    error:       null,
    lastChecked: null,
    history:     [],
    uptime:      null,
  };
});

// ─── DNS cache (async resolver — no libuv thread pool) ────────────────────────

const dnsCache = new Map(); // host -> last known IPv4

async function resolveDns(host) {
  try {
    const addrs = await dns.resolve4(host);
    if (addrs && addrs.length) {
      dnsCache.set(host, addrs[0]);
      return addrs[0];
    }
  } catch { /* keep cached value if refresh fails */ }
  return dnsCache.get(host) ?? null;
}

// ─── Status page API checker ────────────────────────────────────────────────────

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB — guard against runaway status page responses

function checkStatusPageApi(apiUrl, parser) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r) => { if (!settled) { settled = true; resolve(r); } };

    let parsedUrl;
    try { parsedUrl = new URL(apiUrl); } catch { return settle(null); }

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + (parsedUrl.search || ''),
      method:   'GET',
      headers:  { 'User-Agent': 'TheWatcher/1.0', 'Accept': 'application/json' },
      timeout:  5000,
    }, (res) => {
      let body = '';
      let bytesRead = 0;
      res.on('data', chunk => {
        bytesRead += chunk.length;
        if (bytesRead > MAX_BODY_BYTES) {
          res.destroy();
          return settle(null);
        }
        body += chunk;
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (parser === 'statuspage_io') {
            const indicator    = data?.status?.indicator ?? 'unknown';
            const description  = data?.status?.description ?? null;
            settle({
              reportedStatus:      SP_INDICATOR[indicator] ?? 'unknown',
              reportedDescription: description,
            });
          } else if (parser === 'gcp') {
            // incidents.json: active incidents have no 'end' timestamp
            const active = Array.isArray(data) ? data.filter(i => !i.end) : [];
            if (active.length === 0) {
              settle({ reportedStatus: 'operational', reportedDescription: 'All services operational' });
            } else {
              const sev  = (active[0].severity || '').toLowerCase();
              const stat = sev === 'high' ? 'major_outage' : 'degraded';
              const desc = `${active.length} active incident${active.length > 1 ? 's' : ''}: ${active[0].external_desc || active[0].service_name || 'unknown service'}`;
              settle({ reportedStatus: stat, reportedDescription: desc });
            }
          } else {
            settle(null);
          }
        } catch {
          settle(null);
        }
      });
      res.on('error', () => settle(null));
    });

    req.on('timeout', () => { req.destroy(); settle(null); });
    req.on('error', () => settle(null));
    req.end();
  });
}

// ─── HTTP check ────────────────────────────────────────────────────────────────

function checkSite(site, ip = null) {
  return new Promise((resolve) => {
    const start = Date.now();
    let socketStart = null;
    let tcpConnectTime = null;
    let settled = false;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let parsedUrl;
    try {
      parsedUrl = new URL(site.url);
    } catch {
      return settle({ status: 'down', error: 'invalid URL' });
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: ip || parsedUrl.hostname,   // connect to IP if resolved — skips DNS
      port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path:     parsedUrl.pathname || '/',
      method:   'HEAD',
      headers:  {
        'Host':            parsedUrl.hostname,   // required when using IP directly
        'User-Agent':      'Mozilla/5.0 (compatible; TheWatcher/1.0; uptime monitor)',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection':      'keep-alive',
      },
      servername: parsedUrl.hostname,       // TLS SNI — must match cert domain
      timeout:  REQUEST_TIMEOUT_MS,
    };

    const req = lib.request(options, (res) => {
      const ttfb        = Date.now() - (socketStart ?? start);
      const statusCode  = res.statusCode;

      // Use TTFB as responseTime — more representative than waiting for close/end,
      // which can be delayed by keepalive, TCP teardown, or server-side buffering.
      settle({
        status:       statusCode < 500 ? 'up' : 'down',
        statusCode,
        responseTime: ttfb,
        latency:      tcpConnectTime,
      });

      res.resume(); // drain so the connection can be reused
    });

    req.on('socket', (socket) => {
      socketStart = Date.now();
      socket.on('connect', () => {
        tcpConnectTime = Date.now() - socketStart;
      });
    });

    req.on('timeout', () => {
      req.destroy();
      settle({ status: 'down', error: 'timeout', responseTime: REQUEST_TIMEOUT_MS, latency: tcpConnectTime });
    });

    req.on('error', (err) => {
      settle({ status: 'down', error: err.code || err.message, latency: tcpConnectTime });
    });

    req.end();
  });
}

// ─── ICMP ping ─────────────────────────────────────────────────────────────────

function pingHost(host) {
  return new Promise((resolve) => {
    // Use spawn (not exec) — args are passed as an array, never interpolated into a shell string.
    // -c 1 = one packet, -W 2 = 2-second deadline
    let stdout = '';
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    let proc;
    try {
      proc = spawn('ping', ['-c', '1', '-W', '2', host], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return settle(null);
    }

    const timer = setTimeout(() => { proc.kill(); settle(null); }, 3000);

    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return settle(null);
      const match = stdout.match(/time[=<]([\d.]+)\s*ms/);
      settle(match ? parseFloat(match[1]) : null);
    });
    proc.on('error', () => { clearTimeout(timer); settle(null); });
  });
}

// ─── TCP port check ────────────────────────────────────────────────────────────

function checkTcpPort(entry) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const settle = (r) => { if (!settled) { settled = true; resolve(r); } };

    socket.setTimeout(REQUEST_TIMEOUT_MS);

    socket.connect(entry.port, entry.host, () => {
      settle({ status: 'open', latency: Date.now() - start });
      socket.destroy();
    });

    socket.on('error', (err) => {
      socket.destroy();
      settle({ status: 'closed', latency: null, error: err.code || err.message });
    });

    socket.on('timeout', () => {
      socket.destroy();
      settle({ status: 'filtered', latency: null, error: 'timeout' });
    });
  });
}

// ─── UDP port probe ────────────────────────────────────────────────────────────
// Sends an empty datagram and listens for a response or ICMP port-unreachable.
// Result is inherently ambiguous when there's no response:
//   no reply = could be open (service ignores empty probe) or filtered (firewall drops)

function checkUdpPort(entry) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;

    const settle = (r) => {
      if (!settled) {
        settled = true;
        try { socket.close(); } catch {}
        resolve(r);
      }
    };

    const timer = setTimeout(() => {
      settle({ status: 'open|filtered', latency: null, error: 'no response' });
    }, REQUEST_TIMEOUT_MS);

    socket.on('message', () => {
      clearTimeout(timer);
      settle({ status: 'open', latency: null });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      // ECONNREFUSED = ICMP port unreachable = port closed
      settle({
        status: err.code === 'ECONNREFUSED' ? 'closed' : 'error',
        latency: null,
        error: err.code || err.message,
      });
    });

    socket.send(Buffer.alloc(0), entry.port, entry.host, (err) => {
      if (err) {
        clearTimeout(timer);
        settle({ status: 'error', latency: null, error: err.code || err.message });
      }
    });
  });
}

// ─── Run all port checks ───────────────────────────────────────────────────────

async function runPortChecks() {
  if (!PORT_CHECKS.length) return;
  await Promise.allSettled(PORT_CHECKS.map(async (entry) => {
    const key    = `${entry.host}:${entry.port}/${entry.protocol}`;
    const check  = entry.protocol === 'udp' ? checkUdpPort : checkTcpPort;
    const result = await check(entry);
    const d      = portData[key];

    d.status      = result.status;
    d.latency     = result.latency     ?? null;
    d.error       = result.error       ?? null;
    d.lastChecked = new Date().toISOString();

    d.history.push({ timestamp: d.lastChecked, status: d.status, latency: d.latency });
    if (d.history.length > MAX_HISTORY) d.history.shift();

    const opens = d.history.filter(h => h.status === 'open').length;
    d.uptime = d.history.length > 0 ? Math.round((opens / d.history.length) * 100) : null;
  }));
}

// ─── Run all checks ────────────────────────────────────────────────────────────

let checking = false;

async function runChecks() {
  if (checking) return;
  checking = true;
  const started = Date.now();
  console.log(`[${new Date().toISOString()}] Starting checks for ${SITES.length} sites...`);

  // Resolve all DNS in parallel first (async resolver — no thread pool bottleneck)
  const dnsResults = await Promise.allSettled(
    SITES.map(site => resolveDns(site.host).then(ip => ({ host: site.host, ip })))
  );
  const ipMap = new Map();
  dnsResults.forEach(r => {
    if (r.status === 'fulfilled' && r.value.ip) ipMap.set(r.value.host, r.value.ip);
  });

  // Fire all HTTP + ping checks simultaneously with pre-resolved IPs
  const tasks = SITES.map(async (site) => {
    const ip = ipMap.get(site.host) ?? null;

    const [httpResult, pingMs] = await Promise.all([
      checkSite(site, ip),
      pingHost(ip ?? site.host),
    ]);

    const d = siteData[site.host];
    const prevHttpStatus = d.status;

    d.status       = httpResult.status;
    d.statusCode   = httpResult.statusCode  ?? null;
    d.responseTime = httpResult.responseTime ?? null;
    d.latency      = httpResult.latency      ?? null;
    d.ping         = pingMs;
    d.error        = httpResult.error        ?? null;
    d.lastChecked  = new Date().toISOString();

    // Track HTTP down transitions (drives the incident banner)
    if (d.status === 'down' && prevHttpStatus !== 'down') {
      d.httpStatusChangedAt = d.lastChecked;
    } else if (d.status !== 'down') {
      d.httpStatusChangedAt = null;
    }

    d.history.push({
      timestamp:    d.lastChecked,
      status:       d.status,
      responseTime: d.responseTime,
      latency:      d.latency,
      ping:         d.ping,
    });
    if (d.history.length > MAX_HISTORY) d.history.shift();

    const ups = d.history.filter(h => h.status === 'up').length;
    d.uptime = d.history.length > 0 ? Math.round((ups / d.history.length) * 100) : null;
  });

  await Promise.allSettled(tasks);
  checking = false;
  console.log(`[${new Date().toISOString()}] Checks complete in ${Date.now() - started}ms`);
}

// ─── Status page API checks (separate slow cycle) ──────────────────────────────

let spChecking = false;

async function runStatusPageChecks() {
  if (spChecking) return;
  spChecking = true;
  const started = Date.now();
  console.log(`[${new Date().toISOString()}] Starting status page API checks...`);

  const tasks = SITES.map(async (site) => {
    const spConfig = STATUS_PAGE_APIS[site.host] ?? null;
    if (!spConfig || spConfig.parser === 'none') return;

    const spResult = await checkStatusPageApi(spConfig.api, spConfig.parser);
    if (spResult === null) return; // API unreachable — keep last known status

    const d = siteData[site.host];
    const prevReportedStatus = d.reportedStatus;

    d.reportedStatus      = spResult.reportedStatus;
    d.reportedDescription = spResult.reportedDescription;

    // Track reported status transitions (drives the incident banner)
    if (d.reportedStatus && d.reportedStatus !== 'operational' &&
        d.reportedStatus !== prevReportedStatus) {
      d.reportedStatusChangedAt = new Date().toISOString();
    } else if (d.reportedStatus === 'operational') {
      d.reportedStatusChangedAt = null;
    }
  });

  await Promise.allSettled(tasks);
  spChecking = false;
  console.log(`[${new Date().toISOString()}] Status page checks complete in ${Date.now() - started}ms`);
}

// ─── Express routes ────────────────────────────────────────────────────────────

// Precompute the set of valid hostnames for O(1) lookup in /api/status/:host
const ALLOWED_HOSTS = new Set(SITES.map(s => s.host));

// ── Security headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // Inline scripts + styles exist in index.html; allow Google for favicons
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https://www.google.com https://*.gstatic.com data:; " +
    "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; frame-ancestors 'none'",
  );
  next();
});

// ── Rate limiter (no external deps) ──────────────────────────────────────────
const RL_WINDOW_MS = 60_000;
const RL_MAX       = 120;           // requests per window per IP
const rlStore      = new Map();     // ip → { count, resetAt }

// Clean up expired entries every minute to prevent unbounded map growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rlStore) {
    if (now > entry.resetAt) rlStore.delete(ip);
  }
}, 60_000);

function rateLimit(req, res, next) {
  const ip  = req.socket?.remoteAddress ?? 'unknown';
  const now = Date.now();
  let entry = rlStore.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RL_WINDOW_MS };
    rlStore.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RL_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

app.use(express.static(path.join(__dirname, 'public')));

// All sites
app.get('/api/status', rateLimit, (_req, res) => {
  res.json(Object.values(siteData));
});

// Single site by host — host param is validated against the known SITES whitelist
app.get('/api/status/:host', rateLimit, (req, res) => {
  const key = decodeURIComponent(req.params.host);
  if (!ALLOWED_HOSTS.has(key)) return res.status(404).json({ error: 'Site not found' });
  const data = siteData[key];
  if (!data) return res.status(404).json({ error: 'Site not found' });
  res.json(data);
});

// Summary stats
app.get('/api/summary', rateLimit, (_req, res) => {
  const all     = Object.values(siteData);
  const up      = all.filter(s => s.status === 'up').length;
  const down    = all.filter(s => s.status === 'down').length;
  const unknown = all.filter(s => s.status === 'unknown').length;
  res.json({ total: all.length, up, down, unknown });
});

// Active incidents: sites that are down OR reporting non-operational via status page API
app.get('/api/incidents', rateLimit, (_req, res) => {
  const SEVERITY = { critical: 0, major_outage: 1, degraded: 2, unknown: 3 };
  const incidents = Object.values(siteData)
    .filter(s =>
      s.status === 'down' ||
      (s.reportedStatus && s.reportedStatus !== 'operational' && s.reportedStatus !== 'unknown' && s.reportedStatus !== 'unmonitored')
    )
    .map(s => {
      // Build a stable dismiss key that changes when the incident is new/updated
      const changedAt = s.reportedStatusChangedAt || s.httpStatusChangedAt || s.lastChecked;
      return {
        name:             s.name,
        host:             s.host,
        url:              s.url,
        statusPageUrl:    s.statusPageUrl     ?? null,
        httpStatus:       s.status,
        reportedStatus:   s.reportedStatus    ?? null,
        description:      s.reportedDescription ?? null,
        changedAt,
        dismissKey:       `${s.host}::${changedAt}`,
      };
    })
    .sort((a, b) => {
      const sa = SEVERITY[a.reportedStatus] ?? (a.httpStatus === 'down' ? 1 : 99);
      const sb = SEVERITY[b.reportedStatus] ?? (b.httpStatus === 'down' ? 1 : 99);
      return sa - sb || a.name.localeCompare(b.name);
    });
  res.json(incidents);
});

// Port checks
app.get('/api/ports', rateLimit, (_req, res) => {
  res.json(Object.values(portData));
});

// ─── Boot ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`The Watcher running at http://localhost:${PORT}`);
  runChecks().catch(e => console.error('[runChecks boot]', e));
  setInterval(() => runChecks().catch(e => console.error('[runChecks]', e)), CHECK_INTERVAL_MS);
  runStatusPageChecks().catch(e => console.error('[runStatusPageChecks boot]', e));
  setInterval(() => runStatusPageChecks().catch(e => console.error('[runStatusPageChecks]', e)), SP_CHECK_INTERVAL_MS);
  runPortChecks().catch(e => console.error('[runPortChecks boot]', e));
  setInterval(() => runPortChecks().catch(e => console.error('[runPortChecks]', e)), CHECK_INTERVAL_MS);
});
