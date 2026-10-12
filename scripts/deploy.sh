#!/usr/bin/env bash
# Escomblock deployment.
#
#   scripts/deploy.sh mainnet          # production: Circle USDC, real XLM, locked ESCB issuer
#   scripts/deploy.sh testnet [--seed] # staging on testnet (friendbot)
#   scripts/deploy.sh local   [--seed] # local quickstart network (docker), for development
#
# Mainnet requirements (nothing is created or funded for you):
#   RPC_URL       Soroban RPC endpoint for mainnet (SDF hosts none; use a provider)
#   DEPLOYER      stellar CLI identity that pays fees and becomes admin of both
#                 contracts (stellar keys add <name> --secret-key). Needs ~50 XLM.
#   ESCB_ISSUER   stellar CLI identity of a fresh account that issues ESCB. Needs
#                 ~5 XLM. It is LOCKED (master weight 0) at the end, so only the
#                 core contract can ever mint ESCB.
#   TREASURY      G-address that receives the market fee (must trust USDC).
# Optional:
#   PLANTS, LABS  space-separated G-addresses to register
#   HOME_DOMAIN   domain serving /.well-known/stellar.toml for the ESCB asset
#   PRICE_PER_KG  stroops of USDC per kg (default 40000 = 4 USDC per tonne)
#   FEE_BPS       market fee in basis points (default 200 = 2 %)
#   CLAIM_AFTER   seconds before a seller can claim an unconfirmed order (default 7 days)
#   USDC_ASSET    override the USDC asset (CODE:ISSUER)
#   YES=1         skip the mainnet confirmation prompt
set -euo pipefail

NET="${1:-}"
SEED="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_DIR="$ROOT/target/wasm32v1-none/release"
PRICE_PER_KG="${PRICE_PER_KG:-40000}"
FEE_BPS="${FEE_BPS:-200}"
CLAIM_AFTER="${CLAIM_AFTER:-604800}"
DEFAULT_STANDARD='{"min_strength_mpa_x100":350,"max_absorption_pct_x100":1200,"min_thermal_cycles":50}'
STANDARD="${STANDARD:-$DEFAULT_STANDARD}"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

case "$NET" in
  mainnet)
    [[ -n "${RPC_URL:-}" ]] || die "RPC_URL is required for mainnet"
    [[ -n "${DEPLOYER:-}" ]] || die "DEPLOYER (stellar key name) is required for mainnet"
    [[ -n "${ESCB_ISSUER:-}" ]] || die "ESCB_ISSUER (stellar key name) is required for mainnet"
    [[ -n "${TREASURY:-}" ]] || die "TREASURY (G-address) is required for mainnet"
    [[ -z "$SEED" ]] || die "--seed is not allowed on mainnet"
    # PASSPHRASE_OVERRIDE exists only to rehearse this branch on a local network.
    PASSPHRASE="${PASSPHRASE_OVERRIDE:-Public Global Stellar Network ; September 2015}"
    stellar network add escomblock-mainnet --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE"
    NETWORK=escomblock-mainnet
    USDC_ASSET="${USDC_ASSET:-USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN}"
    ENV_FILE="$ROOT/app/.env.production.local"
    APP_NETWORK=mainnet
    BUILD_MODE=production
    ;;
  testnet)
    NETWORK=testnet
    PASSPHRASE="Test SDF Network ; September 2015"
    RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
    FRIENDBOT="https://friendbot.stellar.org"
    ENV_FILE="$ROOT/app/.env.testnet.local"
    APP_NETWORK=testnet
    BUILD_MODE=testnet
    ;;
  local)
    NETWORK=local
    PASSPHRASE="Standalone Network ; February 2017"
    RPC_URL="${RPC_URL:-http://localhost:8000/rpc}"
    FRIENDBOT="http://localhost:8000/friendbot"
    ENV_FILE="$ROOT/app/.env.local"
    APP_NETWORK=local
    BUILD_MODE=development
    ;;
  *)
    die "usage: scripts/deploy.sh <mainnet|testnet|local> [--seed]"
    ;;
esac

net() { echo --network "$NETWORK"; }

# Test networks only: create and fund throwaway identities with friendbot.
key() {
  local name="$1" addr
  stellar keys address "$name" >/dev/null 2>&1 || stellar keys generate "$name" >/dev/null
  addr=$(stellar keys address "$name")
  curl -sf "$FRIENDBOT?addr=$addr" >/dev/null || true
  echo "$addr"
}
invoke() {
  local id="$1" src="$2"
  shift 2
  stellar contract invoke --id "$id" --source-account "$src" $(net) "$@"
}
trust() { stellar tx new change-trust --source-account "$1" --line "$2" $(net) >/dev/null; }
sac() {
  stellar contract asset deploy --asset "$1" --source-account "$2" $(net) >/dev/null 2>&1 || true
  stellar contract id asset --asset "$1" $(net)
}

say "Building contracts"
(cd "$ROOT" && stellar contract build >/dev/null)

if [[ "$NET" == mainnet ]]; then
  ADMIN_KEY="$DEPLOYER"
  ISSUER_KEY="$ESCB_ISSUER"
  ADMIN=$(stellar keys address "$ADMIN_KEY")
  ESCB_ISSUER_ADDR=$(stellar keys address "$ISSUER_KEY")
  cat <<MSG
About to deploy Escomblock to MAINNET
  admin/deployer : $ADMIN
  ESCB issuer    : $ESCB_ISSUER_ADDR  (will be locked: master weight 0)
  USDC           : $USDC_ASSET
  treasury       : $TREASURY
  price          : $PRICE_PER_KG stroops/kg, fee $FEE_BPS bps
MSG
  if [[ "${YES:-}" != 1 ]]; then
    read -r -p "Type 'deploy' to continue: " ok
    [[ "$ok" == deploy ]] || die "aborted"
  fi
else
  say "Accounts (friendbot)"
  ADMIN_KEY=escomblock-admin
  ISSUER_KEY=escb-issuer
  ADMIN=$(key "$ADMIN_KEY")
  ESCB_ISSUER_ADDR=$(key "$ISSUER_KEY")
  TREASURY="${TREASURY:-$(key escomblock-treasury)}"
  if [[ -z "${USDC_ASSET:-}" ]]; then
    # Own test USDC so the test accounts can be funded without a faucet.
    USDC_ASSET="USDC:$(key usdc-issuer)"
    USDC_ADMIN_KEY=usdc-issuer
  fi
fi
ESCB_ASSET="ESCB:$ESCB_ISSUER_ADDR"

say "Stellar Asset Contracts"
USDC_ID=$(sac "$USDC_ASSET" "${USDC_ADMIN_KEY:-$ADMIN_KEY}")
ESCB_ID=$(sac "$ESCB_ASSET" "$ISSUER_KEY")
echo "  USDC $USDC_ID"
echo "  ESCB $ESCB_ID"

say "Deploying escomblock core"
CORE_ID=$(stellar contract deploy --wasm "$WASM_DIR/escomblock.wasm" --source-account "$ADMIN_KEY" $(net) \
  --alias "escomblock-$NET" -- \
  --admin "$ADMIN" --usdc "$USDC_ID" --credit "$ESCB_ID" \
  --price_per_kg "$PRICE_PER_KG" --standard "$STANDARD")
echo "  core   $CORE_ID"

say "Deploying market"
MARKET_ID=$(stellar contract deploy --wasm "$WASM_DIR/escomblock_market.wasm" --source-account "$ADMIN_KEY" $(net) \
  --alias "escomblock-market-$NET" -- \
  --admin "$ADMIN" --core "$CORE_ID" --usdc "$USDC_ID" --credit "$ESCB_ID" \
  --treasury "$TREASURY" --fee_bps "$FEE_BPS" --claim_after "$CLAIM_AFTER")
echo "  market $MARKET_ID"

say "Handing ESCB minting to the core contract"
invoke "$ESCB_ID" "$ISSUER_KEY" -- set_admin --new_admin "$CORE_ID" >/dev/null

if [[ -n "${HOME_DOMAIN:-}" ]]; then
  stellar tx new set-options --source-account "$ISSUER_KEY" --home-domain "$HOME_DOMAIN" $(net) >/dev/null
  echo "  home domain $HOME_DOMAIN"
fi
if [[ -n "${HOME_DOMAIN:-}" ]]; then
  TOML="$ROOT/app/public/.well-known/stellar.toml"
  mkdir -p "$(dirname "$TOML")"
  cat >"$TOML" <<TOML
# Served at https://$HOME_DOMAIN/.well-known/stellar.toml (SEP-1)
VERSION = "2.7.0"
NETWORK_PASSPHRASE = "$PASSPHRASE"

[DOCUMENTATION]
ORG_NAME = "Escomblock"
ORG_URL = "https://$HOME_DOMAIN"
ORG_DESCRIPTION = "Recycled construction rubble turned into lab-certified masonry blocks, traced and paid on Stellar."
ORG_GITHUB = "S41ntx/escomblock"

[[CURRENCIES]]
code = "ESCB"
issuer = "$ESCB_ISSUER_ADDR"
display_decimals = 0
name = "Escomblock circularity credit"
desc = "1 ESCB = 1 kg of construction rubble diverted from landfill into a lab-certified masonry block. Minted only by the Escomblock Soroban contract $CORE_ID when an independent lab certifies a batch; burned when retired. The issuer account is locked."
conditions = "Retire ESCB through the Escomblock contract to claim the impact. Retired credits are burned and recorded on-chain."
is_asset_anchored = false
status = "live"
TOML
  echo "  wrote ${TOML#"$ROOT"/} (commit it so the site serves it)"
fi

if [[ "$NET" == mainnet ]]; then
  say "Locking the ESCB issuer (master weight 0)"
  stellar tx new set-options --source-account "$ISSUER_KEY" --master-weight 0 $(net) >/dev/null
fi

say "Registering roles"
for p in ${PLANTS:-}; do
  invoke "$CORE_ID" "$ADMIN_KEY" -- set_role --account "$p" --role Plant --enabled true >/dev/null
  echo "  plant $p"
done
for l in ${LABS:-}; do
  invoke "$CORE_ID" "$ADMIN_KEY" -- set_role --account "$l" --role Lab --enabled true >/dev/null
  echo "  lab   $l"
done

if [[ "$SEED" == --seed ]]; then
  say "Seeding one full flow with test accounts"
  PLANT=$(key escomblock-plant)
  LAB=$(key escomblock-lab)
  BUILDER=$(key escomblock-builder)
  COLLECTOR=$(key escomblock-collector)
  for a in escomblock-plant escomblock-builder escomblock-collector escomblock-treasury; do
    trust "$a" "$USDC_ASSET" || true
  done
  for a in escomblock-plant escomblock-builder; do trust "$a" "$ESCB_ASSET" || true; done
  if [[ -n "${USDC_ADMIN_KEY:-}" ]]; then
    invoke "$USDC_ID" usdc-issuer -- mint --to "$PLANT" --amount 25000000000 >/dev/null
    invoke "$USDC_ID" usdc-issuer -- mint --to "$BUILDER" --amount 80000000000 >/dev/null
  fi
  invoke "$CORE_ID" "$ADMIN_KEY" -- set_role --account "$PLANT" --role Plant --enabled true >/dev/null
  invoke "$CORE_ID" "$ADMIN_KEY" -- set_role --account "$LAB" --role Lab --enabled true >/dev/null
  invoke "$CORE_ID" escomblock-plant -- record_delivery --plant "$PLANT" --collector "$COLLECTOR" \
    --kg 6200 --origin "Demolición vivienda, Col. Centro, Culiacán" >/dev/null
  invoke "$CORE_ID" escomblock-plant -- record_delivery --plant "$PLANT" --collector "$COLLECTOR" \
    --kg 4800 --origin "Remodelación local, Culiacán" >/dev/null
  invoke "$CORE_ID" escomblock-plant -- create_batch --plant "$PLANT" --delivery_ids '[1,2]' \
    --blocks 2200 --mix "40 % escombro triturado + CPC 30R + arena" >/dev/null
  invoke "$CORE_ID" escomblock-lab -- certify_batch --lab "$LAB" --batch_id 1 \
    --strength_mpa_x100 520 --absorption_pct_x100 980 --thermal_cycles 60 \
    --report_hash "$(printf 'escomblock lote 1' | sha256sum | cut -d' ' -f1)" >/dev/null
  invoke "$MARKET_ID" escomblock-plant -- list --seller "$PLANT" --batch_id 1 --qty 2000 \
    --price_per_block 7500000 >/dev/null
  invoke "$MARKET_ID" escomblock-builder -- buy --buyer "$BUILDER" --listing_id 1 --qty 400 >/dev/null
  invoke "$MARKET_ID" escomblock-plant -- ship --seller "$PLANT" --order_id 1 >/dev/null
  invoke "$MARKET_ID" escomblock-builder -- confirm --buyer "$BUILDER" --order_id 1 >/dev/null
  invoke "$CORE_ID" escomblock-builder -- retire --from "$BUILDER" --amount 10000000000 \
    --beneficiary "Torre Culiacán, etapa 1" >/dev/null
  invoke "$CORE_ID" "$ADMIN_KEY" -- stats
fi

say "Writing ${ENV_FILE#"$ROOT"/}"
{
  echo "VITE_NETWORK=$APP_NETWORK"
  echo "VITE_RPC_URL=$RPC_URL"
  echo "VITE_CORE_ID=$CORE_ID"
  echo "VITE_MARKET_ID=$MARKET_ID"
  echo "VITE_ESCB_ASSET=$ESCB_ASSET"
  echo "VITE_USDC_ASSET=$USDC_ASSET"
} >"$ENV_FILE"
cat "$ENV_FILE"

cat <<MSG

Deployed to $NET.
  core    $CORE_ID
  market  $MARKET_ID
Build the app:  cd app && npm ci && npm run build -- --mode $BUILD_MODE
For GitHub Pages, store the values above as repository variables (see docs/DEPLOY.md).
MSG
