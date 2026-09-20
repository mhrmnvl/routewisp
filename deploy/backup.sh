#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-$HOME/.routewisp}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/routewisp-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y%m%d-%H%M%S)
tar -czf "$BACKUP_DIR/routewisp-$stamp.tar.gz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
find "$BACKUP_DIR" -name "routewisp-*.tar.gz" -mtime "+$KEEP_DAYS" -delete

echo "Backed up $DATA_DIR to $BACKUP_DIR/routewisp-$stamp.tar.gz"
