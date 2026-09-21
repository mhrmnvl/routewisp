#!/usr/bin/env bash
set -euo pipefail

docker stop routewisp 2>/dev/null || true
docker rm routewisp 2>/dev/null || true
docker build -t routewisp .
docker run -d --name routewisp -p 20128:20128 --env-file .env -v routewisp-data:/app/data routewisp
