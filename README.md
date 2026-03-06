# The Watcher

A self-hosted site status monitor that tracks websites in real time, measuring ICMP ping, TCP latency, and HTTP response time. Also monitors TCP/UDP ports and aggregates self-reported status from services with status page APIs.

## Quick Start

### Docker (recommended)

```bash
docker compose up -d
```

Or with `docker run`:

```bash
docker build -t the-watcher .
docker run -d --name the-watcher --cap-add NET_RAW -p 3000:3000 the-watcher
```

Open http://localhost:3000

> `NET_RAW` capability is required for ICMP ping to work inside the container.

### Without Docker

Requires Node.js 18+

```bash
npm install
node server.js
```

## Configuration

Settings in `server.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `PORT` | `3000` | HTTP listen port (or set `PORT` env var) |
| `CHECK_INTERVAL_MS` | `30000` | Check frequency (ms) |
| `REQUEST_TIMEOUT_MS` | `5000` | Request timeout (ms) |

Monitored sites and services are configured via JSON files in the `config/` directory:

| File | Description |
|------|-------------|
| `config/sites.json` | Websites to monitor |
| `config/ports.json` | TCP/UDP port checks |
| `config/status-pages.json` | Status page API mappings |

## Adding Sites

Edit `config/sites.json`:

```json
{ "name": "My Service", "url": "https://example.com", "host": "example.com", "tags": ["http"] }
```

## Adding Port Checks

Edit `config/ports.json`:

```json
{ "name": "My SSH", "host": "10.0.0.1", "port": 22, "protocol": "tcp" }
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | All monitored sites |
| `GET /api/status/:host` | Single site by hostname |
| `GET /api/summary` | Aggregate counts (up/down/unknown) |
| `GET /api/incidents` | Currently down or degraded sites |
| `GET /api/ports` | All port check results |

## License

MIT
