#!/usr/bin/env bash
# Prepares one SMP/XFTP VM for simplex-monitor - the no-Ansible equivalent of
# deploy/ansible/simplex-vms.yml. Idempotent; safe to re-run.
#
# What it does:
#  1. Enables Prometheus metrics in the server INI ([STORE_LOG] prometheus_interval)
#  2. Installs node_exporter and serves the SimpleX metrics file via its
#     textfile collector (symlink; the file has no timestamps so this is valid)
#  3. Firewalls :9100 so only the monitoring VPS can scrape
#  4. Creates the restricted 'smmonitor' user for dashboard restarts/log tails
#
# Run from any machine that can ssh root@<vm>, for all 12 VMs:
#
#   VPS_IP=<status-vps-ip>
#   PUBKEY="$(ssh root@simplex-status cat /opt/simplex-monitor/keys/smmonitor_ed25519.pub)"
#   for h in smp{1..6}.simplexonflux.com xftp{1..6}.simplexonflux.com; do
#     echo "== $h =="
#     ssh "root@$h" "VPS_IP='$VPS_IP' PUBKEY='$PUBKEY' bash -s" < deploy/vm-setup.sh
#   done
set -euo pipefail

: "${VPS_IP:?Set VPS_IP to the monitoring VPS public IP}"
: "${PUBKEY:?Set PUBKEY to the contents of smmonitor_ed25519.pub}"

# --- detect server kind ---
if systemctl list-unit-files | grep -q '^smp-server\.service'; then
  UNIT=smp-server
  INI=/etc/opt/simplex/smp-server.ini
  METRICS=/var/opt/simplex/smp-server-metrics.txt
elif systemctl list-unit-files | grep -q '^xftp-server\.service'; then
  UNIT=xftp-server
  INI=/etc/opt/simplex-xftp/xftp-server.ini
  METRICS=/var/opt/simplex-xftp/xftp-server-metrics.txt
else
  echo "ERROR: neither smp-server nor xftp-server unit found on this host" >&2
  exit 1
fi
echo "kind: $UNIT"

# --- 1. enable prometheus metrics in the INI ---
[ -f "$INI" ] || { echo "ERROR: $INI not found" >&2; exit 1; }
if grep -Eq '^\s*prometheus_interval:' "$INI"; then
  sed -i 's/^\s*prometheus_interval:.*/prometheus_interval: 60/' "$INI"
  echo "prometheus_interval already present - set to 60"
elif grep -q '^\[STORE_LOG\]' "$INI"; then
  sed -i '/^\[STORE_LOG\]/a prometheus_interval: 60' "$INI"
  echo "prometheus_interval: 60 added under [STORE_LOG]"
else
  printf '\n[STORE_LOG]\nprometheus_interval: 60\n' >> "$INI"
  echo "[STORE_LOG] section with prometheus_interval added"
fi
systemctl restart "$UNIT"
echo "$UNIT restarted"

# --- 2. node_exporter + textfile symlink ---
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq prometheus-node-exporter ufw
systemctl enable --now prometheus-node-exporter
TEXTFILE_DIR=/var/lib/prometheus/node-exporter
mkdir -p "$TEXTFILE_DIR"
ln -sfn "$METRICS" "$TEXTFILE_DIR/simplex.prom"
echo "node_exporter serving $METRICS on :9100"

# --- 3. firewall :9100 to the VPS only ---
ufw allow from "$VPS_IP" to any port 9100 proto tcp
ufw deny 9100/tcp
echo "ufw: 9100 allowed from $VPS_IP, denied otherwise"

# --- 4. restricted smmonitor user ---
id smmonitor >/dev/null 2>&1 || useradd --create-home --shell /bin/bash smmonitor
usermod -aG systemd-journal smmonitor
install -d -m 700 -o smmonitor -g smmonitor /home/smmonitor/.ssh
AUTH_LINE="no-port-forwarding,no-X11-forwarding,no-agent-forwarding $PUBKEY"
AUTH_FILE=/home/smmonitor/.ssh/authorized_keys
if [ ! -f "$AUTH_FILE" ] || ! grep -qF "$PUBKEY" "$AUTH_FILE"; then
  echo "$AUTH_LINE" >> "$AUTH_FILE"
fi
chown smmonitor:smmonitor "$AUTH_FILE" && chmod 600 "$AUTH_FILE"
echo "smmonitor ALL=(root) NOPASSWD: /usr/bin/systemctl restart ${UNIT}.service" > /etc/sudoers.d/smmonitor
chmod 440 /etc/sudoers.d/smmonitor
visudo -cf /etc/sudoers.d/smmonitor >/dev/null
echo "smmonitor user ready (restart ${UNIT} + journal read only)"

# --- verify metrics appear ---
sleep 2
if [ -f "$METRICS" ]; then
  echo "metrics file present: $(head -1 "$METRICS")"
else
  echo "NOTE: metrics file not written yet - appears within ~60s of the restart"
fi
echo "DONE"
