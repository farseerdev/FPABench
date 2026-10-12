#!/bin/bash
# Installs the RAMA entry. Needs access to Farseer's npm registry, and Node 22.
set -euo pipefail
cd "$(dirname "$0")"
if [ -f /etc/os-release ] && grep -q 'VERSION_ID="24.04"' /etc/os-release; then
    # The binary needs GLIBCXX_3.4.34 and libatomic. Ubuntu 24.04 ships GCC 14's libstdc++.
    sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libstdc++6 libatomic1
fi
cat > .npmrc <<'RC'
@farseer:registry=https://europe-west1-npm.pkg.dev/farseer-301910/farseer/
//europe-west1-npm.pkg.dev/farseer-301910/farseer/:always-auth=true
RC
npx -y google-artifactregistry-auth --repo-config=.npmrc --credential-config="$HOME/.npmrc"
npm install --no-audit --no-fund
