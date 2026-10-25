> **OBSOLÈTE — ne pas utiliser sur un serveur en production.** Cette procédure écrase le projet et **vide la base de données**. Pour toute mise à jour, suivre **[UPDATE-OFFLINE.md](./UPDATE-OFFLINE.md)** (hors ligne, sans GitHub, données conservées).

# Oilix — Mise à jour complète hors ligne (écraser tout)

Guide pour **remplacer tout le projet** sur le serveur Ubuntu quand :

- **Pas d’Internet** sur le serveur (réseau local uniquement)
- Vous **ne voulez pas garder** les données sur le serveur (base vide = OK)

| Élément | Valeur |
|---------|--------|
| PC Windows | `e:\Projects\Web\Oilix` |
| Serveur Ubuntu | `192.168.1.249` |
| Dossier serveur | `/home/oilixu/oilix` |
| Web (via Nginx) | `http://192.168.1.249` |
| API (via Nginx) | `http://192.168.1.249/api/v1` |
| Direct ports (dev only) | web `:3000` · API `:3001` |

---

## Résumé rapide

1. **WinSCP** : copier `api` + `web` depuis Windows → écraser sur le serveur (sauf `node_modules`)
2. **SSH** : corriger `.env` pour l’IP `192.168.1.249`
3. **SSH** : vider la base + migrations + seed + build + `pm2 restart all`
4. **Clients** : `http://192.168.1.249:3000` + **Ctrl+F5**

---

## Étape 1 — Copier tout depuis Windows (WinSCP)

1. Ouvrir **WinSCP**, se connecter à `192.168.1.249` (SFTP + login SSH).
2. Côté gauche : `e:\Projects\Web\Oilix`
3. Côté droit : `/home/oilixu/oilix`

### Copier et écraser

Glissez-déposez ces dossiers **en remplaçant tout** :

| Depuis Windows | Vers Ubuntu |
|----------------|-------------|
| `api\` | `/home/oilixu/oilix/api/` |
| `web\` | `/home/oilixu/oilix/web/` |

### À ne **pas** copier depuis Windows (important)

| Exclure | Pourquoi |
|---------|----------|
| `api\node_modules\` | Compilé pour Windows — **ne marche pas** sur Ubuntu |
| `web\node_modules\` | Idem |
| `api\dist\` | Regénéré sur le serveur |
| `web\.next\` | Regénéré sur le serveur |

> Les `node_modules` **déjà sur le serveur Ubuntu** (de la première install) restent en place.  
> WinSCP : lors de la synchro, choisissez **ne pas écraser** les dossiers `node_modules` du serveur si Windows tente de les remplacer.

Option : supprimer d’abord le code sur le serveur, garder `node_modules` :

```bash
# Sur Ubuntu (SSH) — avant la copie WinSCP
cd /home/oilixu/oilix
mv api/node_modules /tmp/api-node_modules.bak
mv web/node_modules /tmp/web-node_modules.bak
rm -rf api web
mkdir api web
mv /tmp/api-node_modules.bak api/node_modules
mv /tmp/web-node_modules.bak web/node_modules
```

Puis copiez tout le reste avec WinSCP dans `api/` et `web/`.

---

## Étape 2 — Configurer les fichiers `.env` sur le serveur

Après la copie, le `.env` Windows pointe souvent vers `localhost`. **Corrigez sur Ubuntu** :

### `api/.env`

```bash
nano /home/oilixu/oilix/api/.env
```

```env
DATABASE_URL="postgresql://oilix:VOTRE_MOT_DE_PASSE@localhost:5432/oilix?schema=public"

JWT_SECRET="VOTRE_CLE_JWT_LONGUE"
JWT_EXPIRES_IN="8h"
PORT=3001
HOST=0.0.0.0
PUBLIC_HOST=192.168.1.249

# Include Nginx (port 80) AND direct :3000 if you open that URL
CORS_ORIGIN="http://192.168.1.249,http://192.168.1.249:3000,http://192.168.1.249:8081,exp://192.168.1.249:8081,http://localhost:3000"

NODE_ENV=production
ENABLE_SWAGGER=true
```

> Gardez le **même mot de passe PostgreSQL** que lors de la première installation sur le serveur.

### `web/.env.local` (Nginx — **sans** ports 3000/3001)

```bash
nano /home/oilixu/oilix/web/.env.local
```

```env
NEXT_PUBLIC_API_URL=http://192.168.1.249/api/v1
NEXT_PUBLIC_APP_URL=http://192.168.1.249
PUBLIC_HOST=192.168.1.249
```

> Après chaque changement de `.env.local` : `cd ~/oilix/web && npm run build && pm2 restart oilix-web`

---

## Étape 3 — Réinstaller la base (données effacées)

Connectez-vous en SSH :

```bash
ssh user@192.168.1.249
cd /home/oilixu/oilix/api
```

### Option A — Reset Prisma (simple, tout efface)

```bash
npx prisma generate
npx prisma migrate reset --force
```

Cela supprime toutes les données, réapplique les migrations et lance le **seed** (compte `admin` / `admin123`).

### Option B — Manuel

```bash
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
```

---

## Étape 4 — Build et redémarrage

```bash
cd /home/oilixu/oilix/api
npm run build

cd /home/oilixu/oilix/web
npm run build

cd /home/oilixu/oilix
pm2 restart all
pm2 status
```

Test :

```bash
curl http://127.0.0.1:3001/api/v1/health
```

---

## Script tout-en-un (Ubuntu, après WinSCP + .env corrigés)

```bash
cd /home/oilixu/oilix/api
npx prisma generate
npx prisma migrate reset --force
npm run build

cd /home/oilixu/oilix/web
npm run build

cd /home/oilixu/oilix
pm2 restart all
pm2 status

echo "Web: http://192.168.1.249:3000"
echo "Login: admin / admin123"
```

---

## Étape 5 — Postes clients

Sur chaque PC du réseau :

1. Ouvrir `http://192.168.1.249:3000`
2. **Ctrl + F5** (vider le cache)
3. Se connecter : `admin` / `admin123` — changez le mot de passe dans `/users`

Aucune installation sur les clients : tout passe par le navigateur.

---

## Si `npm run build` échoue (« module not found »)

Les `node_modules` du serveur sont obsolètes (nouveaux paquets dans `package.json`).

**Sans Internet sur le serveur**, il faut recopier des `node_modules` **Linux** :

1. Sur une machine Ubuntu **avec Internet** (ou le serveur une fois connecté) :
   ```bash
   cd /home/oilixu/oilix/api && npm ci
   cd /home/oilixu/oilix/web && npm ci
   tar -czf ~/oilix-modules.tar.gz api/node_modules web/node_modules
   ```
2. Transférer `oilix-modules.tar.gz` par USB ou LAN vers `192.168.1.249`
3. Sur le serveur :
   ```bash
   cd /home/oilixu/oilix
   rm -rf api/node_modules web/node_modules
   tar -xzf ~/oilix-modules.tar.gz
   ```

Puis refaire l’étape 4 (build + pm2).

---

## Dépannage

| Problème | Solution |
|----------|----------|
| Page blanche / ancienne version | `cd /home/oilixu/oilix/web && npm run build && pm2 restart oilix-web` + Ctrl+F5 |
| API ne répond pas | `pm2 logs oilix-api` puis `pm2 restart oilix-api` |
| Erreur base de données | `sudo systemctl status postgresql` |
| CORS dans le navigateur | `CORS_ORIGIN` doit contenir `http://192.168.1.249` (Nginx) **et** `http://192.168.1.249:3000` |
| Login fails after deploy | 1) `curl http://127.0.0.1:3001/api/v1/health` 2) `curl http://127.0.0.1/api/v1/health` (Nginx) 3) Fix CORS + rebuild web 4) `npx prisma migrate deploy` + `npm run prisma:seed` 5) `admin` / `admin123` + Ctrl+F5 |
| WinSCP lent | Copier `api` et `web` sans `node_modules` |

---

## Checklist

- [ ] Copie WinSCP : `api/` + `web/` écrasés (sans `node_modules` Windows)
- [ ] `api/.env` et `web/.env.local` corrigés pour `192.168.1.249`
- [ ] `npx prisma migrate reset --force` (base vide)
- [ ] `npm run build` dans `api/` et `web/`
- [ ] `pm2 restart all`
- [ ] Test navigateur + Ctrl+F5

---

Installation initiale (première fois) : [DEPLOY-UBUNTU.md](./DEPLOY-UBUNTU.md)

**Oilix** — Mise à jour complète LAN · `192.168.1.249` · sans Internet
