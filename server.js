'use strict';

const express = require('express');
const https = require('https');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { spawn } = require('child_process');
const dns = require('dns').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CHECK_INTERVAL_MS    = 30 * 1000;  // 30 seconds — HTTP + ping
const SP_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — status page APIs
const MAX_HISTORY = 30;
const REQUEST_TIMEOUT_MS = 5000;

const SITES = [
  // ── Social / Search ───────────────────────────────────────────────────────
  { name: 'Google',            url: 'https://www.google.com',            host: 'www.google.com',            tags: ['http'] },
  { name: 'YouTube',           url: 'https://www.youtube.com',           host: 'www.youtube.com',           tags: ['http'] },
  { name: 'Facebook',          url: 'https://www.facebook.com',          host: 'www.facebook.com',          tags: ['http'] },
  { name: 'Instagram',         url: 'https://www.instagram.com',         host: 'www.instagram.com',         tags: ['http'] },
  { name: 'X (Twitter)',       url: 'https://x.com',                     host: 'x.com',                     tags: ['http'] },
  { name: 'TikTok',            url: 'https://www.tiktok.com',            host: 'www.tiktok.com',            tags: ['http'] },
  { name: 'Reddit',            url: 'https://www.reddit.com',            host: 'www.reddit.com',            tags: ['http'] },
  { name: 'LinkedIn',          url: 'https://www.linkedin.com',          host: 'www.linkedin.com',          tags: ['http'] },
  { name: 'Pinterest',         url: 'https://www.pinterest.com',         host: 'www.pinterest.com',         tags: ['http'] },
  { name: 'Twitch',            url: 'https://www.twitch.tv',             host: 'www.twitch.tv',             tags: ['http'] },
  { name: 'Discord',           url: 'https://discord.com',               host: 'discord.com',               tags: ['http'] },
  // ── Streaming ─────────────────────────────────────────────────────────────
  { name: 'Netflix',           url: 'https://www.netflix.com',           host: 'www.netflix.com',           tags: ['http'] },
  { name: 'Spotify',           url: 'https://www.spotify.com',           host: 'www.spotify.com',           tags: ['http'] },
  { name: 'Hulu',              url: 'https://www.hulu.com',              host: 'www.hulu.com',              tags: ['http'] },
  { name: 'Disney+',           url: 'https://www.disneyplus.com',        host: 'www.disneyplus.com',        tags: ['http'] },
  { name: 'Max (HBO)',         url: 'https://www.max.com',               host: 'www.max.com',               tags: ['http'] },
  { name: 'Peacock',           url: 'https://www.peacocktv.com',         host: 'www.peacocktv.com',         tags: ['http'] },
  { name: 'SoundCloud',        url: 'https://soundcloud.com',            host: 'soundcloud.com',            tags: ['http'] },
  // ── E-commerce ────────────────────────────────────────────────────────────
  { name: 'Amazon',            url: 'https://www.amazon.com',            host: 'www.amazon.com',            tags: ['http'] },
  { name: 'eBay',              url: 'https://www.ebay.com',              host: 'www.ebay.com',              tags: ['http'] },
  { name: 'Walmart',           url: 'https://www.walmart.com',           host: 'www.walmart.com',           tags: ['http'] },
  { name: 'Target',            url: 'https://www.target.com',            host: 'www.target.com',            tags: ['http'] },
  { name: 'Craigslist',        url: 'https://www.craigslist.org',        host: 'www.craigslist.org',        tags: ['http'] },
  { name: 'Etsy',              url: 'https://www.etsy.com',              host: 'www.etsy.com',              tags: ['http'] },
  { name: 'Shopify',           url: 'https://www.shopify.com',           host: 'www.shopify.com',           tags: ['http'] },
  // ── Productivity / Collaboration ──────────────────────────────────────────
  { name: 'Microsoft',         url: 'https://www.microsoft.com',         host: 'www.microsoft.com',         tags: ['http'] },
  { name: 'Apple',             url: 'https://www.apple.com',             host: 'www.apple.com',             tags: ['http'] },
  { name: 'Wikipedia',         url: 'https://www.wikipedia.org',         host: 'www.wikipedia.org',         tags: ['http'] },
  { name: 'Yahoo',             url: 'https://www.yahoo.com',             host: 'www.yahoo.com',             tags: ['http'] },
  { name: 'Bing',              url: 'https://www.bing.com',              host: 'www.bing.com',              tags: ['http'] },
  { name: 'Outlook',           url: 'https://outlook.live.com',          host: 'outlook.live.com',          tags: ['http'] },
  { name: 'Office 365',        url: 'https://www.office.com',            host: 'www.office.com',            tags: ['http'] },
  { name: 'Dropbox',           url: 'https://www.dropbox.com',           host: 'www.dropbox.com',           tags: ['http'] },
  { name: 'iCloud',            url: 'https://www.icloud.com',            host: 'www.icloud.com',            tags: ['http'] },
  { name: 'Zoom',              url: 'https://zoom.us',                   host: 'zoom.us',                   tags: ['http'] },
  { name: 'Slack',             url: 'https://slack.com',                 host: 'slack.com',                 tags: ['http'] },
  { name: 'Notion',            url: 'https://www.notion.so',             host: 'www.notion.so',             tags: ['http'] },
  { name: 'Trello',            url: 'https://trello.com',                host: 'trello.com',                tags: ['http'] },
  { name: 'Canva',             url: 'https://www.canva.com',             host: 'www.canva.com',             tags: ['http'] },
  { name: 'Figma',             url: 'https://www.figma.com',             host: 'www.figma.com',             tags: ['http'] },
  { name: 'Adobe',             url: 'https://www.adobe.com',             host: 'www.adobe.com',             tags: ['http'] },
  // ── Developer Tools / Platforms ───────────────────────────────────────────
  { name: 'GitHub',            url: 'https://github.com',                host: 'github.com',                tags: ['http'] },
  { name: 'GitLab',            url: 'https://gitlab.com',                host: 'gitlab.com',                tags: ['http'] },
  { name: 'Stack Overflow',    url: 'https://stackoverflow.com',         host: 'stackoverflow.com',         tags: ['http'] },
  { name: 'Cloudflare',        url: 'https://www.cloudflare.com',        host: 'www.cloudflare.com',        tags: ['http'] },
  { name: 'DigitalOcean',      url: 'https://www.digitalocean.com',      host: 'www.digitalocean.com',      tags: ['http'] },
  { name: 'Heroku',            url: 'https://www.heroku.com',            host: 'www.heroku.com',            tags: ['http'] },
  { name: 'Vercel',            url: 'https://vercel.com',                host: 'vercel.com',                tags: ['http'] },
  { name: 'Netlify',           url: 'https://www.netlify.com',           host: 'www.netlify.com',           tags: ['http'] },
  { name: 'WordPress',         url: 'https://wordpress.com',             host: 'wordpress.com',             tags: ['http'] },
  { name: 'Medium',            url: 'https://medium.com',                host: 'medium.com',                tags: ['http'] },
  { name: 'Substack',          url: 'https://substack.com',              host: 'substack.com',              tags: ['http'] },
  { name: 'Atlassian',         url: 'https://www.atlassian.com',         host: 'www.atlassian.com',         tags: ['http'] },
  // ── News / Media ──────────────────────────────────────────────────────────
  { name: 'CNN',               url: 'https://www.cnn.com',               host: 'www.cnn.com',               tags: ['http'] },
  { name: 'BBC',               url: 'https://www.bbc.com',               host: 'www.bbc.com',               tags: ['http'] },
  { name: 'NY Times',          url: 'https://www.nytimes.com',           host: 'www.nytimes.com',           tags: ['http'] },
  { name: 'The Guardian',      url: 'https://www.theguardian.com',       host: 'www.theguardian.com',       tags: ['http'] },
  { name: 'Fox News',          url: 'https://www.foxnews.com',           host: 'www.foxnews.com',           tags: ['http'] },
  { name: 'ESPN',              url: 'https://www.espn.com',              host: 'www.espn.com',              tags: ['http'] },
  { name: 'NFL',               url: 'https://www.nfl.com',               host: 'www.nfl.com',               tags: ['http'] },
  { name: 'NBA',               url: 'https://www.nba.com',               host: 'www.nba.com',               tags: ['http'] },
  // ── Hardware / Tech ───────────────────────────────────────────────────────
  { name: 'Samsung',           url: 'https://www.samsung.com',           host: 'www.samsung.com',           tags: ['http'] },
  { name: 'Nvidia',            url: 'https://www.nvidia.com',            host: 'www.nvidia.com',            tags: ['http'] },
  { name: 'Dell',              url: 'https://www.dell.com',              host: 'www.dell.com',              tags: ['http'] },
  // ── Finance ───────────────────────────────────────────────────────────────
  { name: 'PayPal',            url: 'https://www.paypal.com',            host: 'www.paypal.com',            tags: ['http'] },
  { name: 'Chase Bank',        url: 'https://www.chase.com',             host: 'www.chase.com',             tags: ['http'] },
  { name: 'Bank of America',   url: 'https://www.bankofamerica.com',     host: 'www.bankofamerica.com',     tags: ['http'] },
  { name: 'Wells Fargo',       url: 'https://www.wellsfargo.com',        host: 'www.wellsfargo.com',        tags: ['http'] },
  { name: 'Capital One',       url: 'https://www.capitalone.com',        host: 'www.capitalone.com',        tags: ['http'] },
  { name: 'Venmo',             url: 'https://venmo.com',                 host: 'venmo.com',                 tags: ['http'] },
  { name: 'Robinhood',         url: 'https://robinhood.com',             host: 'robinhood.com',             tags: ['http'] },
  { name: 'Coinbase',          url: 'https://www.coinbase.com',          host: 'www.coinbase.com',          tags: ['http'] },
  { name: 'Stripe',            url: 'https://stripe.com',                host: 'stripe.com',                tags: ['http'] },
  { name: 'Square',            url: 'https://squareup.com',              host: 'squareup.com',              tags: ['http'] },
  // ── Travel / Food ─────────────────────────────────────────────────────────
  { name: 'Airbnb',            url: 'https://www.airbnb.com',            host: 'www.airbnb.com',            tags: ['http'] },
  { name: 'Booking.com',       url: 'https://www.booking.com',           host: 'www.booking.com',           tags: ['http'] },
  { name: 'Expedia',           url: 'https://www.expedia.com',           host: 'www.expedia.com',           tags: ['http'] },
  { name: 'TripAdvisor',       url: 'https://www.tripadvisor.com',       host: 'www.tripadvisor.com',       tags: ['http'] },
  { name: 'Uber',              url: 'https://www.uber.com',              host: 'www.uber.com',              tags: ['http'] },
  { name: 'Lyft',              url: 'https://www.lyft.com',              host: 'www.lyft.com',              tags: ['http'] },
  { name: 'DoorDash',          url: 'https://www.doordash.com',          host: 'www.doordash.com',          tags: ['http'] },
  { name: 'Grubhub',           url: 'https://www.grubhub.com',           host: 'www.grubhub.com',           tags: ['http'] },
  { name: 'Instacart',         url: 'https://www.instacart.com',         host: 'www.instacart.com',         tags: ['http'] },
  // ── CRM / Marketing ───────────────────────────────────────────────────────
  { name: 'Mailchimp',         url: 'https://mailchimp.com',             host: 'mailchimp.com',             tags: ['http'] },
  { name: 'HubSpot',           url: 'https://www.hubspot.com',           host: 'www.hubspot.com',           tags: ['http'] },
  { name: 'Salesforce',        url: 'https://www.salesforce.com',        host: 'www.salesforce.com',        tags: ['http'] },
  { name: 'Zendesk',           url: 'https://www.zendesk.com',           host: 'www.zendesk.com',           tags: ['http'] },
  // ── AI ────────────────────────────────────────────────────────────────────
  { name: 'OpenAI',            url: 'https://openai.com',                host: 'openai.com',                tags: ['http'] },
  { name: 'Anthropic',         url: 'https://www.anthropic.com',         host: 'www.anthropic.com',         tags: ['http'] },
  // ── Status Pages ─────────────────────────────────────────────────────────
  { name: 'AWS Status',        url: 'https://health.aws.amazon.com/health/status', host: 'health.aws.amazon.com',    tags: ['status-page'] },
  { name: 'GCP Status',        url: 'https://status.cloud.google.com',   host: 'status.cloud.google.com',   tags: ['status-page'] },
  { name: 'Azure Status',      url: 'https://azure.status.microsoft/en-us/status', host: 'azure.status.microsoft',   tags: ['status-page'] },
  { name: 'Cloudflare Status', url: 'https://www.cloudflarestatus.com',  host: 'www.cloudflarestatus.com',  tags: ['status-page'] },
  { name: 'GitHub Status',     url: 'https://www.githubstatus.com',      host: 'www.githubstatus.com',      tags: ['status-page'] },
  { name: 'Datadog Status',    url: 'https://status.datadoghq.com',      host: 'status.datadoghq.com',      tags: ['status-page'] },
  { name: 'MongoDB Status',    url: 'https://status.mongodb.com',        host: 'status.mongodb.com',        tags: ['status-page'] },
  { name: 'Fastly Status',     url: 'https://www.fastlystatus.com',      host: 'www.fastlystatus.com',      tags: ['status-page'] },
  // ── Package Repositories ─────────────────────────────────────────────────
  { name: 'Arch Linux',        url: 'https://archlinux.org',             host: 'archlinux.org',             tags: ['api'] },
  { name: 'Fedora Project',    url: 'https://fedoraproject.org',         host: 'fedoraproject.org',         tags: ['api'] },
  { name: 'Ubuntu Packages',   url: 'https://packages.ubuntu.com',       host: 'packages.ubuntu.com',       tags: ['api'] },
  { name: 'Debian Packages',   url: 'https://packages.debian.org',       host: 'packages.debian.org',       tags: ['api'] },
  // ── Language Registries / APIs ───────────────────────────────────────────
  { name: 'npm',               url: 'https://www.npmjs.com',             host: 'www.npmjs.com',             tags: ['api'] },
  { name: 'PyPI',              url: 'https://pypi.org',                  host: 'pypi.org',                  tags: ['api'] },
  { name: 'Docker Hub',        url: 'https://hub.docker.com',            host: 'hub.docker.com',            tags: ['api'] },
  { name: 'Crates.io (Rust)',  url: 'https://crates.io',                 host: 'crates.io',                 tags: ['api'] },
  { name: 'RubyGems',          url: 'https://rubygems.org',              host: 'rubygems.org',              tags: ['api'] },
  { name: 'pkg.go.dev (Go)',   url: 'https://pkg.go.dev',                host: 'pkg.go.dev',                tags: ['api'] },
  { name: 'NuGet (.NET)',      url: 'https://www.nuget.org',             host: 'www.nuget.org',             tags: ['api'] },
  { name: 'Packagist (PHP)',   url: 'https://packagist.org',             host: 'packagist.org',             tags: ['api'] },
  { name: 'Maven Central',     url: 'https://search.maven.org',          host: 'search.maven.org',          tags: ['api'] },
  { name: 'Hackage (Haskell)', url: 'https://hackage.haskell.org',       host: 'hackage.haskell.org',       tags: ['api'] },
];

// ─── TCP / UDP port checks ──────────────────────────────────────────────────────
// These run on the same 30-second cycle as HTTP checks.
// status values: 'open' | 'closed' | 'filtered' | 'open|filtered' | 'error' | 'unknown'
//   open          — TCP connected / UDP got a response
//   closed        — TCP RST / UDP ICMP port unreachable
//   filtered      — connection timed out (firewall dropping packets)
//   open|filtered — UDP: no response and no ICMP unreachable (can't tell)
//
// Add your own checks here:
//   { name: 'My SSH',   host: '10.0.0.1',        port: 22,  protocol: 'tcp' },
//   { name: 'My DNS',   host: '192.168.1.1',      port: 53,  protocol: 'udp' },
const PORT_CHECKS = [
  // ── DNS (TCP :53) ─────────────────────────────────────────────────────────
  { name: 'Google DNS',           host: '8.8.8.8',                    port: 53,   protocol: 'tcp' },
  { name: 'Google DNS (alt)',     host: '8.8.4.4',                    port: 53,   protocol: 'tcp' },
  { name: 'Cloudflare DNS',       host: '1.1.1.1',                    port: 53,   protocol: 'tcp' },
  { name: 'Cloudflare DNS (alt)', host: '1.0.0.1',                    port: 53,   protocol: 'tcp' },
  { name: 'Quad9 DNS',            host: '9.9.9.9',                    port: 53,   protocol: 'tcp' },
  { name: 'OpenDNS',              host: '208.67.222.222',              port: 53,   protocol: 'tcp' },
  // ── NTP (UDP :123) ────────────────────────────────────────────────────────
  { name: 'Google NTP',           host: 'time.google.com',            port: 123,  protocol: 'udp' },
  { name: 'Cloudflare NTP',       host: 'time.cloudflare.com',        port: 123,  protocol: 'udp' },
  { name: 'NTP Pool',             host: 'pool.ntp.org',               port: 123,  protocol: 'udp' },
  { name: 'Windows Time',         host: 'time.windows.com',           port: 123,  protocol: 'udp' },
  { name: 'Apple NTP',            host: 'time.apple.com',             port: 123,  protocol: 'udp' },
  // ── Email — SMTP submission (TCP :587) ────────────────────────────────────
  { name: 'Gmail SMTP',           host: 'smtp.gmail.com',             port: 587,  protocol: 'tcp' },
  { name: 'Microsoft 365 SMTP',   host: 'smtp.office365.com',         port: 587,  protocol: 'tcp' },
  { name: 'Yahoo SMTP',           host: 'smtp.mail.yahoo.com',        port: 587,  protocol: 'tcp' },
  // ── Email — SMTP SSL (TCP :465) ───────────────────────────────────────────
  { name: 'Gmail SMTP SSL',       host: 'smtp.gmail.com',             port: 465,  protocol: 'tcp' },
  { name: 'Outlook SMTP SSL',     host: 'smtp.office365.com',         port: 465,  protocol: 'tcp' },
  // ── Email — IMAP SSL (TCP :993) ───────────────────────────────────────────
  { name: 'Gmail IMAP',           host: 'imap.gmail.com',             port: 993,  protocol: 'tcp' },
  { name: 'Outlook IMAP',         host: 'outlook.office365.com',      port: 993,  protocol: 'tcp' },
  { name: 'Yahoo IMAP',           host: 'imap.mail.yahoo.com',        port: 993,  protocol: 'tcp' },
  // ── Developer — SSH (TCP :22) ─────────────────────────────────────────────
  { name: 'GitHub SSH',           host: 'github.com',                 port: 22,   protocol: 'tcp' },
  { name: 'GitHub SSH (alt)',     host: 'ssh.github.com',             port: 443,  protocol: 'tcp' },
  { name: 'GitLab SSH',           host: 'gitlab.com',                 port: 22,   protocol: 'tcp' },
  // ── Add your own checks below ─────────────────────────────────────────────
  // { name: 'My SSH',            host: '10.0.0.1',                   port: 22,   protocol: 'tcp' },
  // { name: 'My DNS',            host: '192.168.1.1',                port: 53,   protocol: 'udp' },
];

// ─── Status page API endpoints ─────────────────────────────────────────────────
// Keyed by site host (must match the `host` field in SITES).
//
// HOW TO ADD ANY STATUSPAGE.IO-POWERED SITE:
//   Almost every major service uses Atlassian Statuspage (statuspage.io).
//   These pages all expose a machine-readable JSON endpoint at:
//     https://<their-status-domain>/api/v2/status.json
//   Examples that follow this pattern:
//     https://discordstatus.com/api/v2/status.json
//     https://www.zoomstatus.com/api/v2/status.json   ← same format
//     https://status.github.com/api/v2/status.json     ← same format
//   To add a new site: find their status page URL, append /api/v2/status.json,
//   and add an entry below with parser: 'statuspage_io'.
//
// CUSTOM PARSERS:
//   GCP uses its own incidents.json feed — handled by parser: 'gcp'.
//   AWS/Azure status pages are plain HTML — HTTP reachability only (no parser).

const STATUS_PAGE_APIS = {
  // ── Statuspage.io powered (verified working) ──────────────────
  'github.com':                 { api: 'https://www.githubstatus.com/api/v2/status.json',         parser: 'statuspage_io' },
  'discord.com':                { api: 'https://discordstatus.com/api/v2/status.json',            parser: 'statuspage_io' },
  'zoom.us':                    { api: 'https://www.zoomstatus.com/api/v2/status.json',            parser: 'statuspage_io' },
  'www.twitch.tv':              { api: 'https://status.twitch.com/api/v2/status.json',             parser: 'statuspage_io' },
  'www.reddit.com':             { api: 'https://www.redditstatus.com/api/v2/status.json',         parser: 'statuspage_io' },
  'www.notion.so':              { api: 'https://www.notion-status.com/api/v2/status.json',        parser: 'statuspage_io' },
  'www.figma.com':              { api: 'https://status.figma.com/api/v2/status.json',             parser: 'statuspage_io' },
  'www.dropbox.com':            { api: 'https://status.dropbox.com/api/v2/status.json',           parser: 'statuspage_io' },
  'www.shopify.com':            { api: 'https://www.shopifystatus.com/api/v2/status.json',        parser: 'statuspage_io' },
  'www.netlify.com':            { api: 'https://www.netlifystatus.com/api/v2/status.json',        parser: 'statuspage_io' },
  'vercel.com':                 { api: 'https://www.vercel-status.com/api/v2/status.json',        parser: 'statuspage_io' },
  'www.digitalocean.com':       { api: 'https://status.digitalocean.com/api/v2/status.json',     parser: 'statuspage_io' },
  'www.atlassian.com':          { api: 'https://status.atlassian.com/api/v2/status.json',         parser: 'statuspage_io' },
  'www.npmjs.com':              { api: 'https://status.npmjs.org/api/v2/status.json',             parser: 'statuspage_io' },
  'stripe.com':                 { api: 'https://www.stripestatus.com/api/v2/status.json',         parser: 'statuspage_io' },
  'www.hubspot.com':            { api: 'https://status.hubspot.com/api/v2/status.json',           parser: 'statuspage_io' },
  'openai.com':                 { api: 'https://status.openai.com/api/v2/status.json',            parser: 'statuspage_io' },
  'slack.com':                  { api: 'https://status.slack.com',                                parser: 'none' },
  'www.heroku.com':             { api: 'https://status.heroku.com',                               parser: 'none' },
  'gitlab.com':                 { api: 'https://status.gitlab.com',                               parser: 'none' },
  'www.zendesk.com':            { api: 'https://status.zendesk.com',                              parser: 'none' },
  'mailchimp.com':              { api: 'https://status.mailchimp.com',                            parser: 'none' },
  'squareup.com':               { api: 'https://status.squareup.com',                             parser: 'none' },
  'www.coinbase.com':           { api: 'https://status.coinbase.com/api/v2/status.json',          parser: 'statuspage_io' },
  'hub.docker.com':             { api: 'https://status.docker.com',                               parser: 'none' },
  'pypi.org':                   { api: 'https://status.python.org/api/v2/status.json',            parser: 'statuspage_io' },
  'archlinux.org':              { api: 'https://status.archlinux.org',                            parser: 'none' },
  'crates.io':                  { api: 'https://status.crates.io/api/v2/status.json',             parser: 'statuspage_io' },
  'rubygems.org':               { api: 'https://status.rubygems.org/api/v2/status.json',          parser: 'statuspage_io' },
  'www.nuget.org':              { api: 'https://status.nuget.org',                                parser: 'none' },
  // Status sites that ARE the status page
  'www.githubstatus.com':       { api: 'https://www.githubstatus.com/api/v2/status.json',         parser: 'statuspage_io' },
  'www.cloudflarestatus.com':   { api: 'https://www.cloudflarestatus.com/api/v2/status.json',     parser: 'statuspage_io' },
  'status.datadoghq.com':       { api: 'https://status.datadoghq.com/api/v2/status.json',         parser: 'statuspage_io' },
  'status.mongodb.com':         { api: 'https://status.mongodb.com/api/v2/status.json',           parser: 'statuspage_io' },
  // ── Custom parsers ────────────────────────────────────────────
  'status.cloud.google.com':    { api: 'https://status.cloud.google.com/incidents.json',          parser: 'gcp' },
};

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
