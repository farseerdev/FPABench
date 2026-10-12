#!/bin/bash
# Installs the DuckDB entry. Needs Node 22.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
