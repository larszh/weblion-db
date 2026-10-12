#!/usr/bin/env bash
# Runs on the server after GitHub Actions copied a new build into the site folder
# (.github/workflows/deploy.yml). Works by hand too: bash deploy/cloudpanel/update.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

# Non-interactive SSH sessions do not load nvm from .bashrc (CloudPanel Node.js sites use it).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi

command -v pnpm >/dev/null || npm install -g pnpm@10
command -v pm2 >/dev/null || npm install -g pm2

# The build comes from CI, the server only needs the runtime dependencies. CI=true: switching an
# earlier full install to --prod rebuilds node_modules, and without a terminal pnpm would stop
# to ask instead (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
CI=true pnpm install --frozen-lockfile --prod

# Starts the console on the first deploy, reloads it afterwards. Migrations run on start.
pm2 startOrReload deploy/cloudpanel/ecosystem.config.cjs
pm2 save
