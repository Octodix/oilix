# Oilix deployment docs

| Document | When to use |
|----------|-------------|
| **[DEPLOY-FROM-ZERO.md](./DEPLOY-FROM-ZERO.md)** | **New / reinstalled Ubuntu server** (start here) |
| **[DEPLOY-CHECKLIST.md](./DEPLOY-CHECKLIST.md)** | Short checkbox list while installing |
| **[nginx-oilix.conf](./nginx-oilix.conf)** | Nginx site config to copy |
| **[UPDATE-OFFLINE.md](./UPDATE-OFFLINE.md)** | **Every update of a running server** (offline, keeps data) |
| [UPDATE-DEPLOYMENT.md](./UPDATE-DEPLOYMENT.md) | Obsolete — full overwrite that wipes the database; do not use on a server in production |
| **[DEPLOY-UBUNTU.md](./DEPLOY-UBUNTU.md)** | Older LAN guide (prefer FROM-ZERO) |

## Quick facts

- IP: `192.168.1.249`
- Path: `/home/oilixu/oilix` (not `/opt`)
- Repo: `https://github.com/lordsmoha/oilix.git`
- URL: `http://192.168.1.249`
- Login after seed: `admin` / `admin123`

## Critical web env

```env
NEXT_PUBLIC_API_URL=/api/v1
NEXT_PUBLIC_APP_URL=http://192.168.1.249
PUBLIC_HOST=192.168.1.249
```
