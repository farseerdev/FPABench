#!/bin/bash
# Installs the PostgreSQL entry: the PostgreSQL 18 server and the Node client. Needs Node 22.
# The tests start and stop their own server, so the packaged service is not needed.
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(uname)" = Darwin ]; then
    brew list postgresql@18 > /dev/null 2>&1 || brew install postgresql@18
elif [ ! -x /usr/lib/postgresql/18/bin/postgres ]; then
    # The PostgreSQL project's own apt repository, for Debian and Ubuntu. A fresh VM may have no package lists yet.
    sudo apt-get update
    sudo apt-get install -y postgresql-common
    sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
    sudo apt-get install -y postgresql-18
    sudo systemctl disable --now postgresql || true
fi
npm install --no-audit --no-fund
