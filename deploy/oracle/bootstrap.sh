#!/usr/bin/env bash
#
# HCloud Relay — Oracle Cloud VM bootstrap
#
# Provisions a bare Oracle Linux 9 / Ubuntu 22.04+ always-free instance into a
# working, TLS-terminated relay. Safe to re-run: every step is idempotent, so
# this doubles as the upgrade path.
#
#   sudo ./bootstrap.sh
#
# Reads configuration from .env in this directory (copy .env.example first).

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
RELAY_DIR="$REPO_ROOT/upload-server"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

trap 'die "failed at line $LINENO. Nothing was left half-configured that a re-run will not fix."' ERR

[[ $EUID -eq 0 ]] || die "run with sudo"

# ---------------------------------------------------------------------------
# 1. Configuration
# ---------------------------------------------------------------------------
ENV_FILE="$SCRIPT_DIR/.env"
[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE — copy .env.example to .env and fill it in"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${RELAY_HOST:?RELAY_HOST must be set in .env (e.g. relay.yourdomain.com)}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL must be set in .env (for TLS certificate expiry notices)}"
: "${TELEGRAM_API_ID:?TELEGRAM_API_ID must be set in .env}"
: "${TELEGRAM_API_HASH:?TELEGRAM_API_HASH must be set in .env}"
: "${FIREBASE_PROJECT_ID:?FIREBASE_PROJECT_ID must be set in .env}"
: "${CORS_ORIGIN:?CORS_ORIGIN must be set in .env (your Vercel origin)}"

if [[ -z "${STREAM_TOKEN_SECRET:-}" ]]; then
  warn "STREAM_TOKEN_SECRET is empty — the relay will derive the key from"
  warn "TELEGRAM_API_HASH. That works only if Vercel does the same. If you set"
  warn "STREAM_TOKEN_SECRET on Vercel, you MUST set the identical value here."
fi

log "Deploying relay for https://$RELAY_HOST"

# ---------------------------------------------------------------------------
# 2. Detect distro
# ---------------------------------------------------------------------------
if   command -v dnf >/dev/null 2>&1; then PKG=dnf
elif command -v apt-get >/dev/null 2>&1; then PKG=apt
else die "unsupported distro: need dnf (Oracle Linux) or apt (Ubuntu)"
fi
log "Package manager: $PKG"

# ---------------------------------------------------------------------------
# 3. Base packages + Docker
# ---------------------------------------------------------------------------
install_docker_dnf() {
  dnf -y install dnf-plugins-core curl ca-certificates >/dev/null
  if ! dnf config-manager --help >/dev/null 2>&1; then
    dnf -y install 'dnf-command(config-manager)' >/dev/null
  fi
  # Oracle Linux 9 ships a compatible docker-ce via the CentOS repo.
  if [[ ! -f /etc/yum.repos.d/docker-ce.repo ]]; then
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo >/dev/null
  fi
  dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
}

install_docker_apt() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg debian-archive-keyring >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
  fi
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
}

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker already present — skipping install"
else
  log "Installing Docker + compose plugin (this takes a few minutes)"
  if [[ $PKG == dnf ]]; then install_docker_dnf; else install_docker_apt; fi
fi

systemctl enable --now docker >/dev/null
log "Docker is running"

# ---------------------------------------------------------------------------
# 4. Caddy (automatic TLS)
# ---------------------------------------------------------------------------
if command -v caddy >/dev/null 2>&1; then
  log "Caddy already present — skipping install"
elif [[ $PKG == dnf ]]; then
  log "Installing Caddy"
  dnf -y install 'dnf-command(copr)' >/dev/null
  dnf -y copr enable @caddy/caddy >/dev/null
  dnf -y install caddy >/dev/null
else
  log "Installing Caddy"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# ---------------------------------------------------------------------------
# 5. Firewall
# ---------------------------------------------------------------------------
# Oracle images ship with a restrictive local firewall AND enforce a cloud-level
# security list. Both must allow 80/443 — the security list is configured in the
# OCI console (see README.md); this handles the in-VM half.
log "Opening ports 80 and 443 locally"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http  >/dev/null
  firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null
  log "firewalld updated"
elif command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp  >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  log "ufw updated"
fi

# Oracle Linux also installs iptables rules that drop everything except SSH.
# These persist across reboots via iptables-persistent/netfilter.
if command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    # The -C check MUST use the exact same rule spec as the -I insert. An earlier
    # version checked for a rule without the "-m state --state NEW" match while
    # inserting one with it, so the check never matched what had been added and
    # every re-run stacked another duplicate ACCEPT rule.
    rule=(-p tcp --dport "$port" -m state --state NEW -j ACCEPT)
    if ! iptables -C INPUT "${rule[@]}" 2>/dev/null; then
      # Insert above the catch-all REJECT that Oracle's default rules end with;
      # fall back to a plain prepend if there are fewer than 5 existing rules.
      iptables -I INPUT 5 "${rule[@]}" 2>/dev/null \
        || iptables -I INPUT "${rule[@]}"
      log "opened port $port in iptables"
    fi
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null 2>&1 || true
  elif [[ -d /etc/iptables ]]; then
    iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
  elif [[ -f /etc/sysconfig/iptables ]]; then
    iptables-save > /etc/sysconfig/iptables 2>/dev/null || true
  fi
  log "iptables rules persisted"
fi

# ---------------------------------------------------------------------------
# 6. DNS sanity check — fail BEFORE Caddy burns Let's Encrypt rate limit
# ---------------------------------------------------------------------------
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || echo '')"
RESOLVED="$(getent ahostsv4 "$RELAY_HOST" 2>/dev/null | awk 'NR==1{print $1}' || echo '')"

if [[ -z "$RESOLVED" ]]; then
  warn "$RELAY_HOST does not resolve yet."
  warn "Create an A record pointing it at ${PUBLIC_IP:-the public IP of this VM}, then re-run."
  warn "Continuing — Caddy will keep retrying, but TLS stays broken until DNS is right."
elif [[ -n "$PUBLIC_IP" && "$RESOLVED" != "$PUBLIC_IP" ]]; then
  warn "$RELAY_HOST resolves to $RESOLVED but this VM is $PUBLIC_IP."
  warn "Let's Encrypt will fail until the A record points here."
else
  log "DNS OK: $RELAY_HOST -> $RESOLVED"
fi

# ---------------------------------------------------------------------------
# 7. Relay environment file
# ---------------------------------------------------------------------------
log "Writing $RELAY_DIR/.env"
umask 077
cat > "$RELAY_DIR/.env" <<EOF
# Generated by deploy/oracle/bootstrap.sh — do not edit by hand.
# Change deploy/oracle/.env and re-run bootstrap.sh instead.
TELEGRAM_API_ID=$TELEGRAM_API_ID
TELEGRAM_API_HASH=$TELEGRAM_API_HASH
FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID
CORS_ORIGIN=$CORS_ORIGIN
STREAM_TOKEN_SECRET=${STREAM_TOKEN_SECRET:-}
ADMIN_SECRET=${ADMIN_SECRET:-}
RATE_LIMIT_MAX=${RATE_LIMIT_MAX:-600}
RATE_LIMIT_WINDOW_MS=${RATE_LIMIT_WINDOW_MS:-60000}
MAX_CONCURRENT_STREAMS_PER_IP=${MAX_CONCURRENT_STREAMS_PER_IP:-8}
EOF
umask 022

# ---------------------------------------------------------------------------
# 8. Build + start the relay
# ---------------------------------------------------------------------------
log "Building and starting the relay container"
cd "$RELAY_DIR"
docker compose up -d --build

# ---------------------------------------------------------------------------
# 9. Caddy config
# ---------------------------------------------------------------------------
log "Configuring Caddy for $RELAY_HOST"
sed -e "s|__RELAY_HOST__|$RELAY_HOST|g" \
    -e "s|__ADMIN_EMAIL__|$ADMIN_EMAIL|g" \
    "$SCRIPT_DIR/Caddyfile" > /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile 2>/dev/null \
  || die "generated Caddyfile is invalid — not restarting Caddy, the old config is still live"

systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
log "Caddy reloaded"

# ---------------------------------------------------------------------------
# 10. Verify
# ---------------------------------------------------------------------------
log "Waiting for the relay to report healthy..."
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:3001/health >/dev/null 2>&1; then
    log "Relay is healthy on 127.0.0.1:3001"
    break
  fi
  [[ $i -eq 30 ]] && die "relay did not become healthy — check: docker compose logs"
  sleep 2
done

echo
log "Local health response:"
curl -fsS http://127.0.0.1:3001/health | sed 's/^/    /'
echo

log "Checking public TLS endpoint (may need a minute for the certificate)..."
if curl -fsS --max-time 30 "https://$RELAY_HOST/health" >/dev/null 2>&1; then
  log "https://$RELAY_HOST/health is live"
else
  warn "https://$RELAY_HOST/health not reachable yet. Usual causes, in order:"
  warn "  1. OCI security list does not allow ingress on 80/443 (console step)"
  warn "  2. DNS A record not pointing at this VM yet"
  warn "  3. Certificate still being issued — check: journalctl -u caddy -f"
fi

cat <<EOF

$(log 'Done.')

  Relay URL      https://$RELAY_HOST
  Logs           cd $RELAY_DIR && docker compose logs -f
  Restart        cd $RELAY_DIR && docker compose restart
  Caddy logs     journalctl -u caddy -f
  Update         git pull && sudo $SCRIPT_DIR/bootstrap.sh

  NEXT: point the frontend at this relay, from your dev machine:

    node scripts/set-relay-host.mjs https://$RELAY_HOST

  then commit and redeploy Vercel.
EOF
