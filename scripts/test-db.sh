#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="permitpilot-rls-${RANDOM}"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=local-test-only postgres:17-alpine >/dev/null
for attempt in $(seq 1 40); do
 if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
 sleep 0.5
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/database-bootstrap.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/001_initial.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/002_plan_reviews.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/rls.sql
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/plan-rls.sql
