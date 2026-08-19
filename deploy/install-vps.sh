#!/usr/bin/env bash
# SimpleX Monitor - VPS prerequisites installer (Ubuntu 22.04/24.04, run as root).
#
# Installs: Node.js 22 + yarn, tor daemon, simplex-chat CLI, Prometheus, nginx,
# the app itself under /opt/simplex-monitor/app, probe profiles, an SSH key for
# restricted restarts, and both systemd services.
#
# Usage:
#   sudo bash deploy/install-vps.sh [git-repo-url-or-local-path]
set -euo pipefail

REPO_SRC="${1:-}"
APP_DIR=/opt/simplex-monitor/app
APP_USER=simplexmonitor
SIMPLEX_CHAT_BIN=/usr/local/bin/simplex-chat

say() { printf '\n\033[1;33m== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }

say "Base packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg nginx tor prometheus ufw build-essential python3

say "Node.js 22 + yarn"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v yarn >/dev/null || npm install -g yarn

say "simplex-chat CLI (used by the prober for real protocol tests)"
if [ ! -x "$SIMPLEX_CHAT_BIN" ]; then
  . /etc/os-release
  case "${VERSION_ID:-22.04}" in
    24.*) UBU=ubuntu-24_04 ;;
    *)    UBU=ubuntu-22_04 ;;
  esac
  ARCH=$(uname -m)   # x86_64 or aarch64, matching the release asset names
  ASSET="simplex-chat-${UBU}-${ARCH}"
  curl -fL "https://github.com/simplex-chat/simplex-chat/releases/latest/download/${ASSET}" \
    -o "$SIMPLEX_CHAT_BIN"
  chmod +x "$SIMPLEX_CHAT_BIN"
fi
"$SIMPLEX_CHAT_BIN" --version || true

say "Service user + app directory"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/simplex-monitor --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

say "App code"
if [ -n "$REPO_SRC" ]; then
  if [ -d "$REPO_SRC" ]; then
    rsync -a --exclude node_modules --exclude .next --exclude data --exclude .env "$REPO_SRC/" "$APP_DIR/"
  elif [ ! -d "$APP_DIR/.git" ]; then
    git clone "$REPO_SRC" "$APP_DIR"
  else
    git -C "$APP_DIR" pull
  fi
fi
[ -f "$APP_DIR/package.json" ] || { echo "No app code in $APP_DIR - pass a repo URL/path as first argument."; exit 1; }

say "Environment file"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo ">>> EDIT $APP_DIR/.env: ALLOWED_EMAILS, SMTP_*, ALERT_EMAILS <<<"
fi
# Fill/repair generated values even when .env already existed from a partial run
if grep -q '^SESSION_SECRET=change-me' "$APP_DIR/.env" || ! grep -q '^SESSION_SECRET=.\+' "$APP_DIR/.env"; then
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" "$APP_DIR/.env"
  echo "Generated SESSION_SECRET"
fi
sed -i "s|^SIMPLEX_CHAT_BIN=.*|SIMPLEX_CHAT_BIN=${SIMPLEX_CHAT_BIN}|" "$APP_DIR/.env"

say "Install + build"
chown -R "$APP_USER":"$APP_USER" /opt/simplex-monitor
sudo -u "$APP_USER" bash -c "cd $APP_DIR && yarn install --frozen-lockfile && yarn build"

say "Probe profiles (one simplex-chat db per transport lane)"
sudo -u "$APP_USER" bash -c "mkdir -p $APP_DIR/data/probe-profiles"
for lane in ipv4 ipv6 tor; do
  DB="$APP_DIR/data/probe-profiles/probe_${lane}"
  if [ ! -f "${DB}_chat.db" ] && [ ! -f "${DB}.chat.db" ]; then
    printf 'monitor\n' | sudo -u "$APP_USER" "$SIMPLEX_CHAT_BIN" -d "$DB" -t 0 -e '/version' || true
  fi
done

say "SSH key for restricted restarts (public key goes on each VM)"
KEYDIR=/opt/simplex-monitor/keys
mkdir -p "$KEYDIR"
if [ ! -f "$KEYDIR/smmonitor_ed25519" ]; then
  ssh-keygen -t ed25519 -N '' -C 'simplex-monitor restart key' -f "$KEYDIR/smmonitor_ed25519"
fi
chown -R "$APP_USER":"$APP_USER" "$KEYDIR"
chmod 600 "$KEYDIR/smmonitor_ed25519"
echo "Public key to distribute to VMs (deploy/ansible does this):"
cat "$KEYDIR/smmonitor_ed25519.pub"

say "Prometheus scrape config"
if ! grep -q 'job_name: simplex' /etc/prometheus/prometheus.yml; then
  cp /etc/prometheus/prometheus.yml /etc/prometheus/prometheus.yml.bak
  cp "$APP_DIR/deploy/prometheus/prometheus.yml" /etc/prometheus/prometheus.yml
fi
systemctl enable --now prometheus
systemctl restart prometheus

say "Tor daemon (SOCKS on 127.0.0.1:9050)"
systemctl enable --now tor

say "systemd services"
cp "$APP_DIR/deploy/systemd/simplex-monitor-web.service" /etc/systemd/system/
cp "$APP_DIR/deploy/systemd/simplex-monitor-prober.service" /etc/systemd/system/
sed -i "s|ExecStart=/usr/bin/yarn|ExecStart=$(command -v yarn)|" /etc/systemd/system/simplex-monitor-*.service
systemctl daemon-reload
systemctl enable --now simplex-monitor-web simplex-monitor-prober

say "nginx site (edit server_name, then run certbot)"
if [ ! -f /etc/nginx/sites-available/simplex-monitor.conf ]; then
  cp "$APP_DIR/deploy/nginx/simplex-monitor.conf" /etc/nginx/sites-available/
  ln -sf /etc/nginx/sites-available/simplex-monitor.conf /etc/nginx/sites-enabled/
fi
nginx -t && systemctl reload nginx

say "Firewall suggestion (review before enabling!)"
echo "  ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw enable"

say "Done"
cat <<'EOF'
Next steps:
 1. Edit /opt/simplex-monitor/app/.env  (ALLOWED_EMAILS, SMTP_*, ALERT_EMAILS)
 2. systemctl restart simplex-monitor-web simplex-monitor-prober
 3. Point DNS at this VPS, set server_name in the nginx site, run certbot.
 4. Run the Ansible playbook in deploy/ansible against your 12 VMs to enable
    Prometheus metrics + node_exporter + the restricted restart user.
 5. Verify IPv6: 'curl -6 https://ifconfig.co' - if the VPS has no IPv6,
    set PROBE_IPV6=false in .env.
EOF
