# Updating the Oilix server offline (no GitHub, no internet)

The mill server has no internet. Updates go from your Windows PC to the server over the local
network (or a USB stick) as **one file**, a *git bundle*. The server keeps its data, its `.env`
files and its installed packages. Only the code changes.

| | |
|---|---|
| Your PC (code) | `C:\Projects\Web\Oilix` |
| Server | `192.168.1.249` · user `oilixu` |
| Project on the server | `/home/oilixu/oilix` |
| Update files on the server | `/home/oilixu/updates/` |
| Database backups | `/home/oilixu/backups/` (last 15 kept) |

> **Do not** copy the project folder over the server with WinSCP or a USB stick, and do not use the
> old "écraser tout" procedure (`UPDATE-DEPLOYMENT.md`): it can overwrite `.env`, mix old and new
> files, and its database steps wipe all data.

---

## Do I still need GitHub?

No — the server never talks to GitHub.

- **Committing is required.** The bundle contains committed code only. Uncommitted changes are not
  shipped, and the PC script refuses to run while you have any.
- **Pushing to GitHub is optional.** It is an off-site backup of the code. Push whenever your PC has
  internet; it has no effect on the server.

```powershell
git add -A
git commit -m "Describe the change"
git push            # optional, backup only
```

---

## Normal update (3 steps)

### 1. On your PC — make the update package

```powershell
cd C:\Projects\Web\Oilix
powershell -ExecutionPolicy Bypass -File .\scripts\make-update-bundle.ps1
```

This creates the folder **Desktop\oilix-update** with:

| File | What it is |
|---|---|
| `oilix-update.bundle` | the whole code history, one file |
| `server-update.sh` | the script that applies it on the server |
| `VERSION.txt` | commit and date, for your records |

### 2. Copy the folder to the server

**Over the network** (Windows PowerShell, asks for the server password):

```powershell
ssh oilixu@192.168.1.249 "mkdir -p /home/oilixu/updates"
scp $env:USERPROFILE\Desktop\oilix-update\* oilixu@192.168.1.249:/home/oilixu/updates/
```

**Or with a USB stick**: copy the three files, plug the stick into the server, then
`cp /media/oilixu/<STICK>/oilix-update/* /home/oilixu/updates/`.

### 3. On the server — apply it

```bash
ssh oilixu@192.168.1.249
bash /home/oilixu/updates/server-update.sh /home/oilixu/updates/oilix-update.bundle
```

It takes 3–5 minutes and prints each step. When it ends with **"Update finished"**, tell users
to refresh their browser (**Ctrl+F5**).

**Shortcut**: steps 2 and 3 in one go from the PC (asks the password twice):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\make-update-bundle.ps1 -Upload
```

---

## What the server script does

1. Checks the bundle is complete, and that nobody edited code directly on the server.
2. **Backs up the database** to `/home/oilixu/backups/oilix-before-<commit>-<date>.dump`.
3. Moves the code to the new version. `.env`, `node_modules` and the database are untouched.
4. Applies new database migrations (`prisma migrate deploy`). They only add tables and columns,
   and never delete data.
5. Rebuilds the API and the web app, restarts them with pm2, and checks they answer.
6. **If a build or the health check fails, it puts the previous version back automatically** and
   tells you. The database backup from step 2 is kept.

Running it twice with the same bundle does nothing ("Already up to date").
`FORCE=1 bash server-update.sh …` rebuilds anyway.

---

## Undo the last update

```bash
bash /home/oilixu/updates/server-update.sh --rollback
```

This restores the **code** of the previous version and restarts it. The database is kept as is,
since migrations only add things and the old code works with them. The script also prints the
`pg_restore` command to restore the database to the moment before the update. Only use that if
the update damaged data, because it also erases everything recorded since.

---

## When an update adds npm packages

If a change modifies `package.json` or `package-lock.json` (in `api/` or `web/`), the server needs
the new packages, and npm downloads them from the internet. The script detects this:

- **Server online for a moment**: plug the server into a network with internet, run the update,
  then unplug it. The script runs `npm ci` itself.
- **No internet possible**: the script stops **before changing anything**, with a clear message.
  Ship the update without the dependency change, or bring the server online once.

Updates that only change Oilix code never need the internet. The web font (Cairo) is bundled in
the project, so builds are fully offline.

---

## Rules that keep updates safe

- **Never edit code on the server.** Change it on the PC, commit, and ship a bundle. The script
  refuses to update over server-side edits so they are not lost silently.
- **Never copy `.env` files.** The server's `.env` holds its own database password, JWT secret
  and IP (`192.168.1.249`). They are not in the bundle by design.
- **Never run `prisma migrate reset` or `db push` on the server**, and do not run the seed unless
  a release note says so. The seed resets the built-in OPERATOR role's permissions; the admin
  account is not affected.
- Keep the **Desktop\oilix-update** folder of the last update until the next one works.

---

## Troubleshooting

| Message | Meaning / what to do |
|---|---|
| `Uncommitted changes. Commit first` (PC) | Commit, then run the PC script again. |
| `Bundle is damaged or incomplete` | The copy was cut. Copy `oilix-update.bundle` again. |
| `Code was edited directly on the server` | Copy those edits to the PC, commit, rebuild the bundle. To discard them instead: `cd /home/oilixu/oilix && git checkout -- .` |
| `adds/changes npm packages and the server has no internet` | See "When an update adds npm packages". Nothing was changed. |
| `Update NOT applied; previous version is running again` | The new code did not build or start. The site still works on the old version. Send the output above the message to the developer. |
| Site shows the old pages after an update | Ctrl+F5 in the browser. |
| Check the apps | `pm2 ls` · `pm2 logs oilix-api --lines 80` · `pm2 logs oilix-web --lines 80` |
| See server version | `cd /home/oilixu/oilix && git log -1 --oneline` |
