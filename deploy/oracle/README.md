# HCloud Relay on Oracle Cloud (always-free)

The relay is the small Node server that speaks Telegram MTProto. It exists
because gramjs runs neither on Vercel (bundling it crashes the function at cold
start) nor in the browser (many ISPs block MTProto, and it would require shipping
your Telegram `api_hash` to every visitor).

Oracle's **Always Free** tier is a genuinely permanent free VM — not a trial
credit — which is why it replaces Render:

| | Render free | Oracle always-free (Ampere A1) |
|---|---|---|
| Sleeps when idle | Yes, after ~15 min (~50 s cold start) | **Never** |
| RAM | 512 MB | **up to 24 GB** |
| CPU | 0.1 shared | **up to 4 Arm cores** |
| Monthly egress | limited | **10 TB** |
| Cost | $0 | **$0** |

Everything after step 3 is one command. Steps 1-3 need the Oracle console and
your DNS provider, which cannot be scripted.

---

## Prerequisites

- An Oracle Cloud account (<https://signup.oraclecloud.com>). Card verification
  is required at signup; the Always Free resources are not charged.
- **A domain name you control.** Non-negotiable: Let's Encrypt will not issue a
  certificate for a bare IP, and browsers refuse to stream media from an
  untrusted origin. A cheap domain or a free subdomain provider both work.

---

## 1. Create the VM

In the OCI console: **Compute → Instances → Create instance**

| Setting | Value |
|---|---|
| Image | Oracle Linux 9, or Ubuntu 22.04+ |
| Shape | **Ampere A1 Flex** (`VM.Standard.A1.Flex`) |
| OCPUs / RAM | 2 OCPU / 12 GB (well within the free allowance) |
| SSH keys | Upload your public key — you need this to log in |

Note the **public IPv4 address** shown after creation.

> **If you see "Out of host capacity":** Ampere capacity in free regions is often
> exhausted. Either retry periodically, pick a different availability domain, or
> use the always-free AMD shape (`VM.Standard.E2.1.Micro`, 1 GB RAM). The AMD
> shape works — the Dockerfile is multi-arch — but 1 GB RAM means you should keep
> the compose memory limit at 1 G and expect fewer concurrent streams.

## 2. Open the ports in the cloud firewall

This is the step people miss, and it looks exactly like a broken server.
Oracle enforces a network-level Security List **in addition** to the firewall
inside the VM. `bootstrap.sh` configures the in-VM half; this half is yours:

**Networking → Virtual Cloud Networks → your VCN → Subnet → Security List →
Add Ingress Rules**

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

## 3. Point DNS at the VM

Create an **A record** for the hostname you intend to use:

```
relay.yourdomain.com.   A   <the VM's public IPv4>
```

Verify before continuing — TLS issuance fails if this is wrong, and repeated
failures hit Let's Encrypt rate limits:

```bash
dig +short relay.yourdomain.com
```

## 4. Deploy

SSH in, clone, configure, run:

```bash
ssh opc@<public-ip>          # 'opc' on Oracle Linux, 'ubuntu' on Ubuntu

sudo dnf install -y git      # or: sudo apt install -y git
git clone <your-repo-url> hcloud
cd hcloud/deploy/oracle

cp .env.example .env
nano .env                    # fill in every value — see the comments in the file

sudo ./bootstrap.sh
```

`bootstrap.sh` installs Docker and Caddy, opens the in-VM firewall, builds and
starts the relay, obtains a TLS certificate, and verifies the result. It is
idempotent — re-run it to apply config changes or to upgrade after a `git pull`.

When it finishes you should be able to hit it from anywhere:

```bash
curl https://relay.yourdomain.com/health
# {"status":"ok","uptimeSeconds":12,...}
```

## 5. Point the frontend at the new relay

On your **dev machine**, not the VM:

```bash
node scripts/set-relay-host.mjs https://relay.yourdomain.com
```

This rewrites the `connect-src` and `media-src` entries in `vercel.json`'s CSP
(a static string that cannot read env vars — miss it and media fails silently
with only a console error) and updates your local `.env`. It then prints the
`vercel env` commands to run, because those touch Vercel and cannot be scripted
from the repo.

Commit `vercel.json`, redeploy, and confirm an upload and a video playback.

---

## Operating it

```bash
cd ~/hcloud/upload-server

docker compose logs -f          # relay logs
docker compose ps               # container + health status
docker compose restart          # restart
docker compose up -d --build    # rebuild after a git pull

journalctl -u caddy -f          # TLS / proxy logs
systemctl status caddy
```

Health and, if `ADMIN_SECRET` is set, stats:

```bash
curl https://relay.yourdomain.com/health
curl -H "x-admin-secret: $ADMIN_SECRET" https://relay.yourdomain.com/stats
```

### Upgrading

```bash
cd ~/hcloud && git pull && sudo deploy/oracle/bootstrap.sh
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `curl` from outside times out, works on the VM | OCI Security List ingress missing (step 2) |
| Caddy logs show an ACME challenge failure | DNS A record wrong, or port 80 blocked |
| Every request returns 401 | `FIREBASE_PROJECT_ID` wrong in `.env` — it must equal the ID token `aud` |
| BYOD playback 401s but uploads work | `STREAM_TOKEN_SECRET` differs between Vercel and the relay |
| Browser console shows a CSP violation for the relay | Step 5 not run, or `vercel.json` not committed |
| Uploads fail with CORS errors | `CORS_ORIGIN` in `.env` does not include your Vercel origin |
| Relay unhealthy after boot | `docker compose logs` — it exits deliberately on missing config |

## Security model

- The Node process binds to **loopback only**; Caddy is the sole public
  entrypoint and terminates TLS.
- The container runs as an **unprivileged user** with a 1 GB memory cap, so a
  runaway upload cannot take the VM (and your SSH access) down with it.
- Every mutating route requires a **Firebase ID token whose RS256 signature is
  verified** against Google's certificates — not merely decoded.
- `/token-stream` is intentionally public: the AES-256-GCM token *is* the
  capability, so a share link works without the owner's session. The raw
  Telegram session never appears in a URL.
- Per-IP rate limiting and a per-IP concurrent-stream cap are enabled by default.
- Docker log rotation is capped so logs cannot fill the 50 GB boot volume.
