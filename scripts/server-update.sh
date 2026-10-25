#!/usr/bin/env bash
# Oilix — offline server update from a git bundle (no GitHub, no internet).
#
#   bash server-update.sh /home/oilixu/updates/oilix-update.bundle
#   bash server-update.sh --rollback            # back to the code before the last update
#
# What it does, in order:
#   1. checks the bundle and that the server has no local code edits
#   2. backs up the database (pg_dump) to ~/backups
#   3. moves the code to the bundle's commit (keeps .env, node_modules, uploads, data)
#   4. npm ci ONLY if package-lock.json changed (needs internet — stops cleanly otherwise)
#   5. prisma generate + migrate deploy (additive migrations), builds API and web
#   6. restarts pm2 and checks health; on a failed build/health it restores the old code
set -Eeuo pipefail

ROOT="${OILIX_ROOT:-/home/oilixu/oilix}"
BACKUPS="${OILIX_BACKUPS:-/home/oilixu/backups}"
STATE="$ROOT/.last-update"
export CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 NEXT_TELEMETRY_DISABLED=1 npm_config_update_notifier=false

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

db_url() { grep -E '^DATABASE_URL=' "$ROOT/api/.env" | cut -d= -f2- | tr -d '"' | sed 's/?.*//'; }

# Every step checks its own result: `set -e` is inactive inside a function called from `if`.
build_and_restart() {
  say "API: prisma generate + migrations + build"
  cd "$ROOT/api" || return 1
  npx prisma generate >/dev/null || { echo "prisma generate failed"; return 1; }
  npx prisma migrate deploy || { echo "migrate deploy failed"; return 1; }
  npx nest build || { echo "API build failed"; return 1; }
  ok "API built"

  say "Web: build (2–4 min)"
  cd "$ROOT/web" || return 1
  npm run build || { echo "Web build failed"; return 1; }
  ok "Web built"

  say "Restart"
  cd "$ROOT" || return 1
  pm2 restart ecosystem.config.cjs --update-env >/dev/null || { echo "pm2 restart failed"; return 1; }
  pm2 save >/dev/null 2>&1 || true
  sleep 8
  local api web
  api=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/v1/health || true)
  web=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || true)
  echo "API health: $api   Web: $web"
  [[ "$api" == "200" && "$web" == "200" ]]
}

# ── Rollback ──────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--rollback" ]]; then
  [[ -f "$STATE" ]] || die "No previous update recorded ($STATE)."
  # shellcheck disable=SC1090
  source "$STATE"
  say "Rollback code $NEW_COMMIT → $OLD_COMMIT"
  cd "$ROOT"
  git reset --hard "$OLD_COMMIT"
  build_and_restart || die "Rollback build failed — see the output above."
  ok "Code rolled back to $(git log -1 --format='%h %s')"
  echo "Database was NOT restored (migrations are additive, the old code works with it)."
  echo "To restore the database as it was before the update as well:"
  echo "  pg_restore --clean --if-exists -d \"\$(grep ^DATABASE_URL= $ROOT/api/.env | cut -d= -f2- | tr -d '\"' | sed 's/?.*//')\" $DB_BACKUP"
  exit 0
fi

# ── Update ────────────────────────────────────────────────────────────────────
BUNDLE="${1:-}"
[[ -n "$BUNDLE" && -f "$BUNDLE" ]] || die "Usage: bash server-update.sh /path/oilix-update.bundle"
[[ -d "$ROOT/.git" ]] || die "$ROOT is not the Oilix git checkout."
cd "$ROOT"

say "Checking the bundle"
git bundle verify "$BUNDLE" >/dev/null || die "Bundle is damaged or incomplete — copy it again."
git fetch -q -f "$BUNDLE" "main:refs/offline/main"
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse refs/offline/main)
echo "Server : $(git log -1 --format='%h %s' "$OLD")"
echo "Update : $(git log -1 --format='%h %s' "$NEW")"
if [[ "$OLD" == "$NEW" && "${FORCE:-0}" != "1" ]]; then
  ok "Already up to date. (Run with FORCE=1 to rebuild anyway.)"
  exit 0
fi
if ! git merge-base --is-ancestor "$OLD" "$NEW"; then
  echo "⚠ The update is not a continuation of the server's code (history rewritten or older bundle)."
  read -r -p "Continue anyway and replace the code? [y/N] " a
  [[ "$a" == "y" || "$a" == "Y" ]] || die "Cancelled."
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no
  die "Code was edited directly on the server (files above). Copy those edits to the PC, commit them, rebuild the bundle."
fi

DEPS_CHANGED=$(git diff --name-only "$OLD" "$NEW" -- api/package.json api/package-lock.json web/package.json web/package-lock.json || true)
if [[ -n "$DEPS_CHANGED" ]]; then
  echo "Dependencies changed:"; echo "$DEPS_CHANGED"
  if ! curl -s -m 6 -o /dev/null https://registry.npmjs.org/; then
    die "This update adds/changes npm packages and the server has no internet.
   Connect the server to the internet for the update (then run this again),
   or ship an update without dependency changes."
  fi
fi

say "Database backup"
mkdir -p "$BACKUPS"
DB_BACKUP="$BACKUPS/oilix-before-$(git rev-parse --short "$NEW")-$(date +%Y%m%d-%H%M).dump"
pg_dump "$(db_url)" -Fc -f "$DB_BACKUP"
ok "Backup: $DB_BACKUP ($(du -h "$DB_BACKUP" | cut -f1))"
# keep the 15 most recent backups
ls -1t "$BACKUPS"/oilix-*.dump 2>/dev/null | tail -n +16 | xargs -r rm -f

printf 'OLD_COMMIT=%s\nNEW_COMMIT=%s\nDB_BACKUP=%s\nDATE=%s\n' "$OLD" "$NEW" "$DB_BACKUP" "$(date -Is)" > "$STATE"

say "Applying code"
git reset -q --hard "$NEW"
ok "Code at $(git log -1 --format='%h %s')"

if [[ -n "$DEPS_CHANGED" ]]; then
  say "Installing dependencies (internet)"
  (cd "$ROOT/api" && npm ci --no-audit --no-fund)
  (cd "$ROOT/web" && npm ci --no-audit --no-fund)
fi

if build_and_restart; then
  say "Update finished"
  ok "Oilix is running $(git log -1 --format='%h %s')"
  echo "Clients: refresh the browser (Ctrl+F5)."
  echo "Undo if needed:  bash $0 --rollback"
else
  echo
  echo "✘ Build or health check failed — restoring the previous code…" >&2
  git reset -q --hard "$OLD"
  if build_and_restart; then
    die "Update NOT applied; previous version is running again. Database backup: $DB_BACKUP"
  fi
  die "Previous version could not be restarted either. Check: pm2 logs --lines 80"
fi
