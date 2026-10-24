#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/app}"
CONFIG_FILE="$APP_DIR/prisma.docker.config.ts"

wait_for_db() {
    node "$APP_DIR/docker/wait-for-db.cjs"
}

run_migrations() {
    wait_for_db
    echo "[entrypoint] Applying database migrations..."
    prisma migrate deploy --config "$CONFIG_FILE"
    echo "[entrypoint] Database migrations are up to date."
}

bootstrap_admin() {
    wait_for_db
    node "$APP_DIR/docker/bootstrap-admin.cjs"
}

case "${1:-}" in
    migrate)
        run_migrations
        exit 0
        ;;
    bootstrap-admin)
        bootstrap_admin
        exit 0
        ;;
esac

DB_SETUP_ALLOWED=1
if ! node "$APP_DIR/docker/restore-guard.cjs"; then
    DB_SETUP_ALLOWED=0
    echo "[entrypoint] Database restore is unfinished; starting in maintenance mode without migrations or bootstrap."
fi

if [ "$DB_SETUP_ALLOWED" = "1" ] && [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    run_migrations
fi

if [ "$DB_SETUP_ALLOWED" = "1" ] && { [ -n "${BOOTSTRAP_ADMIN_LOGIN:-}" ] || [ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]; }; then
    bootstrap_admin
fi

exec "$@"
