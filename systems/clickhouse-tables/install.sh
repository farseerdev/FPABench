#!/bin/bash
# Installs the ClickHouse entry: the server binary and the Node client. Needs Node 22.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=26.9.16.11
if ! command -v clickhouse > /dev/null || ! clickhouse --version | grep -q "$VERSION"; then
    if [ "$(uname)" = Darwin ]; then
        brew install --cask clickhouse
    else
        curl -fsSL "https://github.com/ClickHouse/ClickHouse/releases/download/v${VERSION}-stable/clickhouse-common-static-${VERSION}-amd64.tgz" | tar -xz
        sudo install -m 755 "clickhouse-common-static-${VERSION}/usr/bin/clickhouse" /usr/local/bin/clickhouse
        rm -rf "clickhouse-common-static-${VERSION}"
    fi
fi
clickhouse --version
npm install --no-audit --no-fund
