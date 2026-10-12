# Production deployment (Stellar mainnet)

This puts Escomblock on Stellar mainnet with Circle USDC and serves the dApp from GitHub Pages. Every step uses real funds, so read it through once before starting.

## 1. What you need

| Item | Why | Notes |
| --- | --- | --- |
| `stellar` CLI ≥ 23 | build, deploy, invoke | `cargo install --locked stellar-cli` |
| Mainnet RPC URL | SDF does not host a public mainnet RPC | Any provider from the [Stellar RPC providers list](https://developers.stellar.org/docs/data/apis/rpc/providers). Must allow browser CORS, because the dApp calls it directly. |
| **Deployer** account | pays fees, becomes admin of both contracts | ~50 XLM. Use a hardware wallet or a dedicated key; move admin to a multisig later with `set_admin`. |
| **ESCB issuer** account | issues the ESCB credit asset | A **fresh** account with ~5 XLM. It is locked (master weight 0) at the end of the deploy and can never be used again. |
| **Treasury** address | receives the 2 % market fee (collectors' fund) | Must have a USDC trustline before the first sale. |
| Plant and lab addresses | registered roles | Each must have XLM (to exist) and a USDC trustline; plants also an ESCB trustline (the app has buttons for both). |
| A domain (optional) | serves `/.well-known/stellar.toml` so wallets show ESCB's name and description | |

## 2. Deploy the contracts

```bash
stellar keys add escomblock-deployer --secret-key       # paste the deployer's secret
stellar keys add escomblock-escb-issuer --secret-key    # paste the fresh issuer's secret

RPC_URL=https://<your-mainnet-rpc> \
DEPLOYER=escomblock-deployer \
ESCB_ISSUER=escomblock-escb-issuer \
TREASURY=G...TREASURY \
PLANTS="G...PLANT" \
LABS="G...LAB" \
HOME_DOMAIN=escomblock.example \
./scripts/deploy.sh mainnet
```

The script asks you to type `deploy`, then:

1. builds both contracts;
2. deploys the Stellar Asset Contracts for Circle USDC (`GA5Z…KZVN`) and for `ESCB:<issuer>`;
3. deploys the core contract (admin = deployer, price 0.004 USDC/kg, standard 3.5 MPa / 12 % / 50 cycles; override with `PRICE_PER_KG`, `STANDARD`) and the market (fee `FEE_BPS`, claim window `CLAIM_AFTER`);
4. makes the core contract the ESCB SAC admin, so only certified batches mint ESCB;
5. sets the issuer's home domain and writes `app/public/.well-known/stellar.toml`;
6. **locks the ESCB issuer** (master weight 0): the issuer can no longer issue ESCB through classic payments, so the only way to create ESCB is a lab certification;
7. registers the plant and lab roles;
8. writes `app/.env.production.local` with the values the app needs.

The whole deploy path has been rehearsed against a real Stellar network: the `local` network in Docker, with the mainnet branch run through `PASSPHRASE_OVERRIDE`. That rehearsal checked that ESCB is still minted on certification after the lock, that a classic ESCB payment from the issuer fails with `TxBadAuth`, and that the roles are registered.

## 3. Publish the dApp

1. Commit `app/public/.well-known/stellar.toml` if you set `HOME_DOMAIN`.
2. In GitHub: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `VITE_NETWORK` | `mainnet` |
   | `VITE_RPC_URL` | your RPC URL |
   | `VITE_CORE_ID` | core contract id |
   | `VITE_MARKET_ID` | market contract id |
   | `VITE_ESCB_ASSET` | `ESCB:G…issuer` |
   | `VITE_BASE` | `/` with a custom domain, otherwise leave unset (`/escomblock/`) |

4. Merge to `main` (or run **Deploy app** manually). The workflow builds the app with those values and publishes it.

Any static host works the same way: `cd app && npm ci && npm run build -- --mode production` reads `app/.env.production.local` and outputs `app/dist/`.

## 4. Operate

```bash
C=escomblock-mainnet
CORE=<core id>; MARKET=<market id>

# register or revoke roles
stellar contract invoke --id $CORE --source-account escomblock-deployer --network $C -- set_role --account G... --role Plant --enabled true

# change the payout price or the certification standard
stellar contract invoke --id $CORE --source-account escomblock-deployer --network $C -- set_params --price_per_kg 50000 \
  --standard '{"min_strength_mpa_x100":350,"max_absorption_pct_x100":1200,"min_thermal_cycles":50}'

# emergency stop (views keep working; market orders already open can still settle)
stellar contract invoke --id $CORE   --source-account escomblock-deployer --network $C -- set_paused --paused true
stellar contract invoke --id $MARKET --source-account escomblock-deployer --network $C -- set_paused --paused true

# ship new contract code without changing addresses or data
HASH=$(stellar contract upload --wasm target/wasm32v1-none/release/escomblock.wasm --source-account escomblock-deployer --network $C)
stellar contract invoke --id $CORE --source-account escomblock-deployer --network $C -- upgrade --new_wasm_hash $HASH

# hand admin to a multisig account
stellar contract invoke --id $CORE --source-account escomblock-deployer --network $C -- set_admin --new_admin G...MULTISIG
```

Records are stored in persistent storage and extended for 180 days on every write. Data that is not touched for longer must be restored: `stellar contract extend` can do this from a scheduled job.

## 5. Staging

`./scripts/deploy.sh testnet --seed` runs the same deployment on testnet with friendbot accounts and a full sample flow. Build the app for it with `npm run build -- --mode testnet`.
