# simplex-monitor

Monitoring dashboard and probe engine for the SimpleX SMP/XFTP fleet
(`smp1-6.simplexonflux.com`, `xftp1-6.simplexonflux.com`), run by
[Flux](https://runonflux.com). Replaces Uptime Kuma and the old
`service-monitor` SimpleX checks.

> **Running your own SimpleX servers?** This stack is reusable: put your
> servers (hostnames, fingerprints, onion addresses) in `config/servers.json`,
> configure `.env`, and follow the deploy docs below. MIT licensed.

## What it does

- **Real protocol probes over three transports.** Every ~3 minutes each server is
  tested with the `simplex-chat` CLI (`/_server test`) separately over **IPv4**,
  **IPv6** (by dialing resolved IP literals — SimpleX validates servers by key
  fingerprint, not hostname) and **Tor** (via the local SOCKS proxy using the
  `.onion` address). So a silent IPv6 or Tor breakage is visible even while IPv4
  still works.
- **Uptime & incidents.** Probe history is stored in SQLite; the dashboard shows
  per-transport uptime (24h/7d/30d), Uptime-Kuma-style 90-day bars, and derived
  incidents. Incidents open after N consecutive failures and close on recovery,
  with email alerts both ways.
- **Server stats.** The SimpleX servers' native Prometheus metrics (enabled with
  one INI line, served through node_exporter's textfile collector) are scraped by
  a local Prometheus; the dashboard charts messages/queues/clients (SMP), file
  activity/storage (XFTP) and host CPU/memory.
- **TLS certificate expiry** checks daily, with alerts 14 days out.
- **Restarts & logs** from the dashboard over SSH, restricted on the VM side to
  `systemctl restart <unit>` (sudoers) and journal reads. Every action lands in
  the audit log.
- **Email-code login.** Only allowlisted emails can log in; they receive a
  6-digit code by email (10 min validity), then get a 7-day session cookie.
  Responses don't reveal whether an email is allowlisted; requests are
  rate-limited.

## Architecture

```
                         status VPS
  ┌──────────────────────────────────────────────────┐
  │  simplex-monitor-web (Next.js :3334) ── nginx/TLS│◄── admins (email OTP)
  │  simplex-monitor-prober (worker)                 │
  │      │  simplex-chat CLI ── direct / tor SOCKS ──┼──► 12 servers (v4/v6/onion)
  │      ▼                                           │
  │  SQLite (probes, incidents, certs, audit, otp)   │
  │  Prometheus :9090 ◄── scrapes :9100 ─────────────┼──► node_exporter on each VM
  │  ssh (restricted smmonitor key) ─────────────────┼──► systemctl restart …
  └──────────────────────────────────────────────────┘
```

## VPS prerequisites

Ubuntu 22.04/24.04 with: Node.js 22 + yarn, `tor` (SOCKS on 127.0.0.1:9050),
`prometheus`, `nginx`, and the `simplex-chat` CLI binary. All of it is installed
by the script:

```bash
sudo bash deploy/install-vps.sh https://github.com/<you>/simplex-monitor.git
```

Afterwards:

1. Edit `/opt/simplex-monitor/app/.env` — `ALLOWED_EMAILS`, `SMTP_*`,
   `ALERT_EMAILS` (see `.env.example` for every option).
2. `systemctl restart simplex-monitor-web simplex-monitor-prober`
3. Set `server_name` in `/etc/nginx/sites-available/simplex-monitor.conf`,
   point DNS, run `certbot --nginx -d <host>`.
4. Check the VPS has working IPv6 (`curl -6 https://ifconfig.co`); if not, set
   `PROBE_IPV6=false` so v6 lanes are skipped instead of reported down.

## Preparing the 12 VMs

```bash
cd deploy/ansible
cp inventory.example.ini inventory.ini   # set monitor_vps_ip + monitor_pubkey
ansible-playbook -i inventory.ini simplex-vms.yml
```

Per VM this: enables `prometheus_interval: 60` under `[STORE_LOG]` in the server
INI (metrics land in `smp-server-metrics.txt` / `xftp-server-metrics.txt`),
installs node_exporter with a symlink so the metrics file is served on :9100,
firewalls :9100 to the VPS IP, and creates the `smmonitor` user whose SSH key
can only restart the SimpleX unit (sudoers-scoped) and read its journal.

Requires collections: `ansible-galaxy collection install community.general ansible.posix`.

## Development

```bash
yarn install
cp .env.example .env        # fill in at least SESSION_SECRET, ALLOWED_EMAILS, SMTP_*
yarn dev                    # dashboard on http://localhost:3334
yarn prober                 # probe worker (needs simplex-chat CLI + tor for full runs)
```

macOS dev note: the official `simplex-chat` macOS binary links Homebrew's
`openssl@3.0` at a hardcoded path. If it fails with a dyld error, point
`SIMPLEX_CHAT_BIN` at a wrapper script that sets
`DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/opt/openssl@3/lib` before `exec`-ing
the binary (env DYLD_* vars are stripped when Node spawns children, so it must
be a wrapper). Not needed on Linux.

Checks (all must pass before committing):

```bash
yarn type-check && yarn lint && yarn format:check && yarn build && yarn test
```

## Repo layout

| Path | Purpose |
|---|---|
| `config/servers.json` | The 12 servers: fingerprints, onions, SSH targets |
| `prober/` | Probe worker: CLI checks, incidents, alerts, cert expiry |
| `lib/` | Shared: SQLite, config, auth/OTP, sessions, SSH, Prometheus, uptime math |
| `app/` | Next.js dashboard + API routes |
| `components/` | UI: charts, uptime bars, status dots, nav |
| `tests/` | Vitest unit tests (uptime math, incident state machine) |
| `deploy/` | VPS installer, systemd units, nginx, Prometheus config, Ansible for VMs |

## Security notes

- The dashboard must only be reachable over HTTPS (nginx + certbot).
- `SESSION_SECRET` signs both sessions and OTP hashes — keep it secret, rotate to
  force global logout.
- The SSH private key on the VPS can only run `systemctl restart smp-server|xftp-server`
  and read journals on the VMs; treat the VPS as trusted infrastructure anyway.
- node_exporter (:9100) is firewalled per-VM to the VPS IP; nothing else is
  exposed by the monitoring setup.
- Restarts and log reads are recorded in the audit log with the acting email.
