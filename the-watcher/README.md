# The Watcher

![Docker Build](https://github.com/YOUR_GITHUB_USERNAME/The-Watcher/actions/workflows/docker-publish.yml/badge.svg)

A self-hosted site status monitor. Watches 111 sites in real time, measuring **ICMP ping**, **TCP latency**, and **HTTP response time** for each one. Aggregates self-reported status from services that expose a status page API. Also probes TCP/UDP ports independently of HTTP — useful for checking DNS resolvers, NTP servers, email servers, SSH endpoints, and anything else that listens on a known port.

---

## Features

- **111 sites monitored** — social media, cloud providers, streaming, banking, developer tools, package registries, and more
- **Three independent metrics per site:**
  - `Ping` — raw ICMP round-trip time
  - `Latency` — TCP connection time (time to establish the socket)
  - `Response` — time-to-first-byte from the moment the socket connects (includes TLS + HTTP overhead)
- **TCP / UDP port checks** — check whether a port is `open`, `closed`, or `filtered` on any host or IP, independent of HTTP
- **Site type tags** — every site is tagged `http`, `api`, or `status-page`; port checks are tagged `tcp` or `udp`; tags are auto-assigned based on `STATUS_PAGE_APIS` membership
- **Dual check cycles:**
  - HTTP + ping + port checks every **30 seconds**
  - Status page APIs every **5 minutes**
- **Self-reported status** — polls the official status page API (statuspage.io / custom) for 35+ services and surfaces their own incident descriptions
- **Incident banner** — sticky top banner appears when any site is down or degraded; per-item and dismiss-all controls stored in `sessionStorage`; "unmonitored" sites are excluded
- **Slow detection** — sites responding above 800 ms are tagged `SLOW` separately from `DOWN`
- **Priority sorting** — down / slow / unknown sites always float to the top, regardless of selected sort order
- **Search + filter** — filter by All / Up / Down / Slow / Has Status API / HTTP / API / Status Pages / TCP+UDP; sort by name, response time, or ping
- **Service favicons** — each card shows the site's favicon via Google's favicon service
- **DNS pre-resolution** — all hostnames resolved before requests fire, eliminating per-request DNS overhead
- **Pre-resolved IP routing** — HTTP requests connect directly to the IP; TLS SNI still uses the hostname so certificates validate correctly
- **Zero runtime dependencies beyond Express** — pure Node.js standard library for all networking, including the rate limiter

---

## Security

The server applies the following hardening without any additional npm packages:

| Area | Detail |
|---|---|
| **Security headers** | Every response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Permitted-Cross-Domain-Policies: none`, `Content-Security-Policy` (restricts resources to self + Google for favicons), and removes `X-Powered-By` |
| **Rate limiting** | API endpoints are limited to 120 requests per minute per IP (in-memory, no external dep). Clients over the limit receive `429 Too Many Requests`. |
| **Shell injection** | ICMP ping uses `spawn()` with an argument array — the hostname is never interpolated into a shell string |
| **Response size cap** | Status page API responses are capped at 1 MB; the stream is destroyed if the limit is exceeded |
| **Host param whitelist** | `/api/status/:host` validates the decoded parameter against a precomputed set of known hostnames. Unknown values return 404 without touching the data store |
| **URL scheme validation** | All server-supplied URLs rendered in `href` attributes are validated client-side — only `https:` and `http:` schemes are accepted (`javascript:` and others are dropped) |
| **CSS class injection** | `reportedStatus` values are whitelisted before being interpolated into CSS class names |
| **XSS** | All server-supplied strings rendered into HTML go through `escHtml()` |

---

## Monitored Site Categories

| Category | Tag | Examples |
|---|---|---|
| Search / Social | `http` | Google, YouTube, Facebook, Instagram, X, TikTok, Reddit |
| Streaming | `http` | Netflix, Hulu, Disney+, Max, Peacock, Twitch, SoundCloud, Spotify |
| E-commerce | `http` | Amazon, eBay, Walmart, Target, Etsy, Shopify, Craigslist |
| Productivity | `http` | Microsoft, Office 365, Outlook, Dropbox, iCloud, Zoom, Slack, Notion, Trello |
| Dev tools | `http` | GitHub, GitLab, Stack Overflow, Vercel, Netlify, Heroku, Atlassian, WordPress |
| Finance | `http` | PayPal, Stripe, Square, Venmo, Robinhood, Coinbase, Chase, BoA, Wells Fargo |
| Travel / Food | `http` | Airbnb, Booking.com, Expedia, Uber, Lyft, DoorDash, Grubhub, Instacart |
| News / Media | `http` | CNN, BBC, NY Times, The Guardian, Fox News, ESPN, NFL, NBA |
| Design / Creative | `http` | Figma, Canva, Adobe |
| CRM / Marketing | `http` | HubSpot, Salesforce, Zendesk, Mailchimp |
| AI | `http` | OpenAI, Anthropic |
| Cloud status pages | `status-page` | AWS Status, GCP Status, Azure Status, Cloudflare Status, GitHub Status, Datadog Status |
| Package repos | `api` | Arch Linux, Fedora Project, Ubuntu Packages, Debian Packages |
| Language registries | `api` | npm, PyPI, crates.io (Rust), RubyGems, pkg.go.dev (Go), NuGet (.NET), Packagist (PHP), Maven Central, Hackage (Haskell), Docker Hub |

---

## Port Checks

Port checks run on the same 30-second cycle as HTTP checks. They are independent of the HTTP site list and appear in their own section at the bottom of the dashboard.

### Built-in checks

| Name | Host | Port | Protocol | Notes |
|---|---|---|---|---|
| Google DNS | 8.8.8.8 | 53 | TCP | |
| Google DNS (alt) | 8.8.4.4 | 53 | TCP | |
| Cloudflare DNS | 1.1.1.1 | 53 | TCP | |
| Cloudflare DNS (alt) | 1.0.0.1 | 53 | TCP | |
| Quad9 DNS | 9.9.9.9 | 53 | TCP | |
| OpenDNS | 208.67.222.222 | 53 | TCP | |
| Google NTP | time.google.com | 123 | UDP | See note below |
| Cloudflare NTP | time.cloudflare.com | 123 | UDP | See note below |
| NTP Pool | pool.ntp.org | 123 | UDP | See note below |
| Windows Time | time.windows.com | 123 | UDP | See note below |
| Apple NTP | time.apple.com | 123 | UDP | See note below |
| Gmail SMTP | smtp.gmail.com | 587 | TCP | STARTTLS submission |
| Microsoft 365 SMTP | smtp.office365.com | 587 | TCP | STARTTLS submission |
| Yahoo SMTP | smtp.mail.yahoo.com | 587 | TCP | STARTTLS submission |
| Gmail SMTP SSL | smtp.gmail.com | 465 | TCP | SMTP over SSL |
| Outlook SMTP SSL | smtp.office365.com | 465 | TCP | SMTP over SSL |
| Gmail IMAP | imap.gmail.com | 993 | TCP | IMAP over SSL |
| Outlook IMAP | outlook.office365.com | 993 | TCP | IMAP over SSL |
| Yahoo IMAP | imap.mail.yahoo.com | 993 | TCP | IMAP over SSL |
| GitHub SSH | github.com | 22 | TCP | Standard SSH |
| GitHub SSH (alt) | ssh.github.com | 443 | TCP | Used when :22 is blocked |
| GitLab SSH | gitlab.com | 22 | TCP | Standard SSH |

### Port check status values

| Status | Meaning |
|---|---|
| `open` | TCP: connection accepted. UDP: server sent a response. |
| `closed` | TCP: connection refused (RST). UDP: ICMP port-unreachable received — server is up but actively rejecting the port. |
| `filtered` | TCP: connection timed out — a firewall is silently dropping packets. |
| `open\|filtered` | UDP only: no response and no ICMP unreachable. The port is reachable but it is impossible to tell if it is open or filtered without a protocol-specific probe. |
| `error` | Socket or resolution error — check the `error` field for the reason code. |
| `unknown` | Not yet checked since startup. |

### Note on UDP / NTP

The `checkUdpPort` probe sends an **empty datagram** and waits for a reply or an ICMP port-unreachable error.

NTP servers expect a properly formatted NTP client packet (mode 3, 48 bytes). They will not respond to an empty datagram, so NTP checks will always show **`open|filtered`**. This is still meaningful:

- **`open|filtered`** — the NTP port is reachable; no firewall is actively dropping packets.
- **`closed`** — an ICMP port-unreachable came back, meaning the server is up but not running NTP on that port.
- **`error`** — DNS resolution failed or the socket errored before anything was sent.

If you need to verify that an NTP server is actually responding to queries, use `ntpdate -q <host>` or `chronyc` from the host machine instead.

### Adding port checks

Add entries to the `PORT_CHECKS` array in `server.js`:

```js
{ name: 'My SSH',     host: '10.0.0.1',        port: 22,  protocol: 'tcp' },
{ name: 'My DNS',     host: '192.168.1.1',      port: 53,  protocol: 'udp' },
{ name: 'My SMTP',    host: 'mail.example.com', port: 587, protocol: 'tcp' },
```

Restart the server. The new checks appear in the dashboard immediately and are available at `GET /api/ports`.

---

## Running with Docker (recommended)

### Pull the pre-built image

Every merge to `main` publishes a multi-arch image (`linux/amd64` + `linux/arm64`) to the GitHub Container Registry:

```bash
docker pull ghcr.io/YOUR_GITHUB_USERNAME/the-watcher:latest
```

Run it:

```bash
docker run -d \
  --name the-watcher \
  --cap-add NET_RAW \
  -p 3000:3000 \
  ghcr.io/YOUR_GITHUB_USERNAME/the-watcher:latest
```

### docker compose

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** `cap_add: NET_RAW` is set in `docker-compose.yml`. This is required for ICMP ping to work inside the container. Without it, ping will silently return `null` and only HTTP/TCP metrics will be shown. TCP and UDP port checks work without this capability.

### docker run

```bash
docker build -t the-watcher .

docker run -d \
  --name the-watcher \
  --cap-add NET_RAW \
  -p 3000:3000 \
  the-watcher
```

### Custom port

```bash
docker run -d \
  --name the-watcher \
  --cap-add NET_RAW \
  -p 8080:8080 \
  -e PORT=8080 \
  the-watcher
```

---

## Running without Docker

Requires Node.js 18+.

```bash
npm install
node server.js
```

Development mode (auto-restarts on file change):

```bash
npm run dev
```

---

## Configuration

All configuration is at the top of `server.js`:

| Constant | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port (overridden by `PORT` env var) |
| `CHECK_INTERVAL_MS` | `30000` | How often HTTP + ping + port checks run (ms) |
| `SP_CHECK_INTERVAL_MS` | `300000` | How often status page APIs are polled (ms) |
| `MAX_HISTORY` | `30` | Number of check results retained per site |
| `REQUEST_TIMEOUT_MS` | `5000` | HTTP request timeout and TCP/UDP connect timeout (ms) |
| `MAX_BODY_BYTES` | `1048576` | Maximum response body size accepted from status page APIs (1 MB) |
| `RL_WINDOW_MS` | `60000` | Rate limit window duration in ms |
| `RL_MAX` | `120` | Maximum API requests per IP per window |

---

## API Reference

All endpoints return JSON. All `/api/*` endpoints are rate-limited to 120 requests per minute per IP. Responses over the limit return `429 Too Many Requests`.

---

### `GET /api/status`

Returns the full status array for all monitored HTTP sites.

**Response** — array of site objects:

```json
[
  {
    "name": "GitHub",
    "url": "https://github.com",
    "host": "github.com",
    "tags": ["status-page"],
    "status": "up",
    "statusCode": 200,
    "responseTime": 312,
    "latency": 18,
    "ping": 9.4,
    "error": null,
    "lastChecked": "2026-03-05T14:22:01.000Z",
    "history": [
      {
        "timestamp": "2026-03-05T14:21:31.000Z",
        "status": "up",
        "responseTime": 298,
        "latency": 17,
        "ping": 8.9
      }
    ],
    "uptime": 100,
    "reportedStatus": "operational",
    "reportedDescription": "All Systems Operational",
    "hasStatusApi": true,
    "statusPageUrl": "https://www.githubstatus.com",
    "reportedStatusChangedAt": null,
    "httpStatusChangedAt": null
  }
]
```

**Field reference:**

| Field | Type | Description |
|---|---|---|
| `tags` | `string[]` | Type tags: `"http"`, `"api"`, or `"status-page"`. Sites with a `STATUS_PAGE_APIS` entry are automatically tagged `"status-page"`. |
| `status` | `"up"` \| `"down"` \| `"unknown"` | Result of the last HTTP check |
| `statusCode` | `number \| null` | HTTP response code |
| `responseTime` | `number \| null` | ms from TCP socket connect to first byte of HTTP response |
| `latency` | `number \| null` | ms for TCP handshake only |
| `ping` | `number \| null` | ICMP round-trip ms (`null` if ping unavailable) |
| `uptime` | `number \| null` | Percentage of `up` results in the rolling history window |
| `reportedStatus` | `"operational"` \| `"degraded"` \| `"major_outage"` \| `"critical"` \| `"unknown"` \| `"unmonitored"` \| `null` | Status reported by the service's own status page API. `"unmonitored"` means the service has a known status page URL but no machine-readable API. |
| `reportedDescription` | `string \| null` | Human-readable description from the status page API |
| `hasStatusApi` | `boolean` | `true` if this site has a working status page API (excludes `parser: 'none'` entries) |
| `statusPageUrl` | `string \| null` | URL to the human-readable status page |
| `httpStatusChangedAt` | ISO string \| `null` | When the site last transitioned to `down` |
| `reportedStatusChangedAt` | ISO string \| `null` | When `reportedStatus` last changed to a non-operational value |

---

### `GET /api/status/:host`

Returns the status object for a single site by hostname. The `:host` parameter is validated against the known `SITES` list — arbitrary hostnames return 404.

```
GET /api/status/github.com
GET /api/status/status.cloud.google.com
```

**404 response** if the host is not in the monitored list:

```json
{ "error": "Site not found" }
```

---

### `GET /api/summary`

Returns aggregate counts across all HTTP-monitored sites.

```json
{
  "total": 111,
  "up": 108,
  "down": 1,
  "unknown": 2
}
```

---

### `GET /api/incidents`

Returns sites that are currently `down` or reporting a non-operational status via their status page API. Sites with `reportedStatus: "unmonitored"` are excluded. Sorted by severity (critical → major outage → degraded), then alphabetically.

```json
[
  {
    "name": "Discord",
    "host": "discord.com",
    "url": "https://discord.com",
    "statusPageUrl": "https://discordstatus.com",
    "httpStatus": "up",
    "reportedStatus": "degraded",
    "description": "Voice services experiencing elevated latency",
    "changedAt": "2026-03-05T12:00:00.000Z",
    "dismissKey": "discord.com::2026-03-05T12:00:00.000Z"
  }
]
```

An empty array `[]` means no active incidents.

**Field reference:**

| Field | Description |
|---|---|
| `httpStatus` | Our own observed HTTP status (`"up"` / `"down"`) |
| `reportedStatus` | What the service says about itself |
| `dismissKey` | Stable key used by the frontend to track dismissed banners; changes when the incident is updated |

---

### `GET /api/ports`

Returns the full status array for all configured TCP/UDP port checks.

**Response** — array of port check objects:

```json
[
  {
    "key": "8.8.8.8:53/tcp",
    "name": "Google DNS",
    "host": "8.8.8.8",
    "port": 53,
    "protocol": "tcp",
    "tags": ["tcp"],
    "status": "open",
    "latency": 12,
    "error": null,
    "lastChecked": "2026-03-05T14:22:01.000Z",
    "history": [
      {
        "timestamp": "2026-03-05T14:21:31.000Z",
        "status": "open",
        "latency": 11
      }
    ],
    "uptime": 100
  }
]
```

**Field reference:**

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Unique identifier in the format `host:port/protocol` |
| `tags` | `string[]` | `["tcp"]` or `["udp"]` |
| `status` | `"open"` \| `"closed"` \| `"filtered"` \| `"open\|filtered"` \| `"error"` \| `"unknown"` | Result of the last probe |
| `latency` | `number \| null` | ms for TCP connect. Always `null` for UDP (no handshake to measure) |
| `uptime` | `number \| null` | Percentage of `open` results in the rolling history window |

---

## Adding a Site

1. Add an entry to the `SITES` array in `server.js`:

```js
{ name: 'My Service', url: 'https://myservice.example', host: 'myservice.example', tags: ['http'] },
```

Available tags: `'http'` (default website), `'api'` (developer API / registry), `'status-page'` (the URL is itself a status page). If you add a `STATUS_PAGE_APIS` entry for the site (see step 2), the tag is overridden to `'status-page'` automatically.

2. If the service has a statuspage.io-powered status page, add it to `STATUS_PAGE_APIS`:

```js
'myservice.example': { api: 'https://status.myservice.example/api/v2/status.json', parser: 'statuspage_io' },
```

> Almost every major service uses Atlassian Statuspage. The JSON endpoint is always at `<status-domain>/api/v2/status.json`.

If you know the status page URL but there is no machine-readable API, use `parser: 'none'`. The UI will show "Can't monitor status page" instead of polling an API:

```js
'myservice.example': { api: 'https://status.myservice.example', parser: 'none' },
```

3. Restart the server.

---

## How Metrics Are Measured

```
Timeline for a single HTTPS check:

  [socket assigned by OS]
        │
        ├──── TCP handshake ────┤ ← Latency
        │
        ├──── TLS handshake ─────────────┤
        │
        ├──── HTTP HEAD + server processing + first byte ──────┤ ← Response time
```

- **Latency** and **Response** are both measured from the moment the OS assigns a socket — not from when `checkSite()` is called. This removes Node.js event loop scheduling overhead that would otherwise inflate both values when 100+ requests fire in parallel.
- **Ping** is independently measured via `spawn('ping', ['-c', '1', '-W', '2', host])`. It reflects raw ICMP RTT with no connection overhead. Using `spawn` (not `exec`) means the hostname is never interpolated into a shell string.
- A healthy site typically shows: Ping < Latency < Response. The gap between Latency and Response is dominated by TLS handshake and server processing time.

### TCP port check

Connects to `host:port` using `net.Socket`, records the time to `connect` event, then immediately destroys the socket. Status is `open` on connect, `closed` on `ECONNREFUSED`, and `filtered` on timeout.

### UDP port probe

Sends an empty datagram to `host:port` using `dgram`. Waits for:
- A response packet → `open`
- `ECONNREFUSED` (ICMP port-unreachable) → `closed`
- Timeout with no response → `open|filtered`

Because the probe is an empty payload rather than a valid protocol message, servers that only reply to well-formed requests (such as NTP, DNS, SNMP) will not respond. The result will be `open|filtered`, which still confirms the port is reachable and not blocked by a firewall. To distinguish open from filtered for those protocols you would need a protocol-aware probe (e.g. `ntpdate -q` for NTP, `dig` for DNS).
