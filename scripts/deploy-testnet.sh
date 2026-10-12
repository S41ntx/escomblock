#!/usr/bin/env bash
# Deploys Escomblock to Stellar testnet end to end and writes app/.env.local.
#
#   ./scripts/deploy-testnet.sh          # deploy + register roles + fund demo accounts
#   ./scripts/deploy-testnet.sh --seed   # ...and run one full flow so the app has data
#
# Requires: stellar CLI >= 23 (cargo install --locked stellar-cli), Rust with the
# wasm32v1-none target. Every account is created and funded with friendbot.
#
# Assets: by default a test "USDC" is issued by a local `usdc-issuer` key so the
# demo accounts can be funded freely. To use Circle's testnet USDC instead, set
# USDC_ASSET=USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 and
# fund the plant/builder accounts yourself (https://faucet.circle.com).
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_DIR="$ROOT/target/wasm32v1-none/release"
PRICE_PER_KG="${PRICE_PER_KG:-40000}"   # stroops: 0.004 USDC/kg = 4 USDC per tonne
FEE_BPS="${FEE_BPS:-200}"               # 2 % of each sale to the collectors' fund
CLAIM_AFTER="${CLAIM_AFTER:-604800}"    # 7 days
STANDARD='{"min_strength_mpa_x100":350,"max_absorption_pct_x100":1200,"min_thermal_cycles":50}'

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
net() { echo --network "$NETWORK"; }

key() {
  local name="$1"
  if ! stellar keys address "$name" >/dev/null 2>&1; then
    stellar keys generate "$name" --fund $(net) >/dev/null
  else
    stellar keys fund "$name" $(net) >/dev/null 2>&1 || true
  fi
  stellar keys address "$name"
}

invoke() { # invoke <contract> <source> -- fn args...
  local id="$1" src="$2"; shift 2
  stellar contract invoke --id "$id" --source-account "$src" $(net) "$@"
}

trust() { # trust <account> <CODE:ISSUER>
  stellar tx new change-trust --source-account "$1" --line "$2" $(net) >/dev/null
}

sac() { # sac <CODE:ISSUER> <issuer-key> -> contract id
  stellar contract asset deploy --asset "$1" --source-account "$2" $(net) >/dev/null 2>&1 || true
  stellar contract id asset --asset "$1" $(net)
}

say "Building contracts"
(cd "$ROOT" && stellar contract build)

say "Accounts (friendbot)"
ADMIN=$(key escomblock-admin)
PLANT=$(key escomblock-plant)
LAB=$(key escomblock-lab)
BUILDER=$(key escomblock-builder)
COLLECTOR=$(key escomblock-collector)
TREASURY=$(key escomblock-treasury)
ESCB_ISSUER=$(key escb-issuer)
printf '  admin     %s\n  plant     %s\n  lab       %s\n  builder   %s\n  collector %s\n' \
  "$ADMIN" "$PLANT" "$LAB" "$BUILDER" "$COLLECTOR"

say "Assets"
if [[ -z "${USDC_ASSET:-}" ]]; then
  USDC_ISSUER=$(key usdc-issuer)
  USDC_ASSET="USDC:$USDC_ISSUER"
  OWN_USDC=1
  USDC_ADMIN_KEY=usdc-issuer
fi
ESCB_ASSET="ESCB:$ESCB_ISSUER"
for acct in escomblock-plant escomblock-builder escomblock-collector escomblock-treasury; do
  trust "$acct" "$USDC_ASSET" || true
done
for acct in escomblock-plant escomblock-builder; do
  trust "$acct" "$ESCB_ASSET" || true
done
USDC_ID=$(sac "$USDC_ASSET" "${USDC_ADMIN_KEY:-escomblock-admin}")
ESCB_ID=$(sac "$ESCB_ASSET" escb-issuer)
echo "  USDC SAC  $USDC_ID"
echo "  ESCB SAC  $ESCB_ID"

say "Deploying escomblock core"
CORE_ID=$(stellar contract deploy --wasm "$WASM_DIR/escomblock.wasm" --source-account escomblock-admin $(net) \
  --alias escomblock -- \
  --admin "$ADMIN" --usdc "$USDC_ID" --credit "$ESCB_ID" \
  --price_per_kg "$PRICE_PER_KG" --standard "$STANDARD")
echo "  core      $CORE_ID"

say "Deploying market"
MARKET_ID=$(stellar contract deploy --wasm "$WASM_DIR/escomblock_market.wasm" --source-account escomblock-admin $(net) \
  --alias escomblock-market -- \
  --admin "$ADMIN" --core "$CORE_ID" --usdc "$USDC_ID" --credit "$ESCB_ID" \
  --treasury "$TREASURY" --fee_bps "$FEE_BPS" --claim_after "$CLAIM_AFTER")
echo "  market    $MARKET_ID"

say "Handing ESCB minting rights to the core contract"
invoke "$ESCB_ID" escb-issuer -- set_admin --new_admin "$CORE_ID" >/dev/null

say "Registering roles"
invoke "$CORE_ID" escomblock-admin -- set_role --account "$PLANT" --role Plant --enabled true >/dev/null
invoke "$CORE_ID" escomblock-admin -- set_role --account "$LAB" --role Lab --enabled true >/dev/null

if [[ -n "${OWN_USDC:-}" ]]; then
  say "Minting test USDC (plant 2 500, builder 8 000)"
  invoke "$USDC_ID" usdc-issuer -- mint --to "$PLANT" --amount 25000000000 >/dev/null
  invoke "$USDC_ID" usdc-issuer -- mint --to "$BUILDER" --amount 80000000000 >/dev/null
fi

if [[ "${1:-}" == "--seed" ]]; then
  say "Seeding one full flow"
  invoke "$CORE_ID" escomblock-plant -- record_delivery --plant "$PLANT" --collector "$COLLECTOR" \
    --kg 6200 --origin "Demolición vivienda, Col. Centro, Hermosillo"
  invoke "$CORE_ID" escomblock-plant -- record_delivery --plant "$PLANT" --collector "$COLLECTOR" \
    --kg 4800 --origin "Remodelación local, Blvd. Kino, Hermosillo"
  invoke "$CORE_ID" escomblock-plant -- create_batch --plant "$PLANT" --delivery_ids '[1,2]' \
    --blocks 2200 --mix "40 % escombro triturado + CPC 30R + arena"
  invoke "$CORE_ID" escomblock-lab -- certify_batch --lab "$LAB" --batch_id 1 \
    --strength_mpa_x100 520 --absorption_pct_x100 980 --thermal_cycles 60 \
    --report_hash "$(printf 'escomblock lote 1' | sha256sum | cut -d' ' -f1)"
  invoke "$MARKET_ID" escomblock-plant -- list --seller "$PLANT" --batch_id 1 --qty 2000 \
    --price_per_block 7500000
  invoke "$MARKET_ID" escomblock-builder -- buy --buyer "$BUILDER" --listing_id 1 --qty 400
  invoke "$MARKET_ID" escomblock-plant -- ship --seller "$PLANT" --order_id 1
  invoke "$MARKET_ID" escomblock-builder -- confirm --buyer "$BUILDER" --order_id 1
  invoke "$CORE_ID" escomblock-builder -- retire --from "$BUILDER" --amount 10000000000 \
    --beneficiary "Torre Pitic, etapa 1"
  invoke "$CORE_ID" escomblock-admin -- stats
fi

say "Writing app/.env.local"
cat > "$ROOT/app/.env.local" <<EOF
VITE_NETWORK=$NETWORK
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_EXPLORER=https://stellar.expert/explorer/testnet
VITE_CORE_ID=$CORE_ID
VITE_MARKET_ID=$MARKET_ID
VITE_USDC_ID=$USDC_ID
VITE_ESCB_ID=$ESCB_ID
EOF
cat "$ROOT/app/.env.local"

cat <<EOF

Done. Next:
  cd app && npm install && npm run dev
  Import a role into Freighter (Settings > Import account) with its secret:
    stellar keys show escomblock-plant     # plant
    stellar keys show escomblock-lab       # lab
    stellar keys show escomblock-builder   # builder
  Explorer: https://stellar.expert/explorer/testnet/contract/$CORE_ID
EOF
