# Escomblock

**Construction rubble → certified building blocks → paid collectors, traceable on Stellar.**

*Escombro + block.* Escomblock began as a student research project: a masonry block made with recycled construction rubble that stays strong and well-bonded in the heat and water exposure of Hermosillo, Sonora. This repository turns that research into a working circular-economy platform on **Stellar + Soroban**.

> 🇪🇸 [Resumen en español](#resumen-en-español) · 🚀 [Production deployment](docs/DEPLOY.md) · 🧱 [Architecture](docs/ARCHITECTURE.md) · 🎬 [Pitch video script](docs/PITCH.md) · ✅ [Submission checklist](docs/SUBMISSION.md)

---

## The problem

- In most of Mexico, construction and demolition rubble (*escombro*) is practically unregulated. It ends up in vacant lots, roadsides and dry riverbeds. The research behind Escomblock found only one company recycling it, selling it as cheap fill to level land.
- The people who move rubble are often informal workers paid in cash, late, or not at all, with no record of the work they do.
- Recycled materials have a trust problem: builders don't know whether a "green" block is actually strong, and companies that claim to recycle can't prove how much they diverted, or they count the same impact twice.

## The solution

Escomblock connects four actors through two Soroban contracts:

| Step | Who | What happens on Stellar |
| --- | --- | --- |
| 1. **Scale ticket** | Plant + collector | The plant weighs a rubble delivery; `record_delivery` pays the collector **USDC in the same transaction** (0.004 USDC/kg by default = 4 USDC per tonne). |
| 2. **Batch** | Plant | `create_batch` groups deliveries into a production batch. Every kilo stays linked to its origin; a delivery can never be used twice. |
| 3. **Lab certification** | Independent lab | `certify_batch` records compressive strength, water absorption, heat-humidity cycles and the SHA-256 of the lab report. If the batch meets the standard, the contract **mints ESCB credits** (1 ESCB = 1 kg of rubble diverted) to the plant. A plant can never certify itself. |
| 4. **Market + retirement** | Builder | The builder buys blocks with USDC held in **escrow**. On delivery the plant is paid (minus a 2 % fee to a collectors' fund) and the ESCB that belong to those blocks move to the builder, who can `retire` them to claim the impact. Retired credits are burned. |

Every batch has a public **block passport** (lab results + every source delivery + who was paid) behind a QR code printed on the blocks.

## Why Stellar

- **Micropayments that make sense.** A rubble delivery is worth 10–30 USDC. Sub-cent fees and ~5 s finality make paying every single trip viable; Stellar anchors let collectors cash out to local currency.
- **Credits are real Stellar assets.** ESCB is a classic Stellar asset whose Stellar Asset Contract (SAC) admin is the Escomblock contract. Only certified batches can mint it, yet it shows up in any wallet, can be traded on the DEX, and is burned on retirement.
- **Rules in Soroban, not in a spreadsheet.** Roles, double-use protection, lab independence, escrow and timeouts are enforced on-chain and covered by 25 contract tests plus an end-to-end suite that runs the app against a real Stellar network in CI.
- **Circle USDC via SAC.** Payouts and purchases use the Stellar Asset Contract of Circle's USDC on mainnet.
- **Supply you can audit.** The ESCB issuer account is locked after deployment (master weight 0): no one, including the team, can issue ESCB outside the contract. The asset is described in a SEP-1 `stellar.toml`.

## Repository

```
contracts/
  escomblock/        core: roles, deliveries + payouts, batches, lab certification, ESCB mint, retirement, passport
  market/            escrowed marketplace for certified blocks, bundling ESCB with each block
app/                 React + Vite dApp: reads straight from the contracts, signs with Freighter
scripts/deploy.sh    mainnet | testnet | local deployment (assets, contracts, roles, issuer lock, stellar.toml)
.github/workflows/   CI (contracts, app, e2e on a Dockerized Stellar network) + GitHub Pages deploy
docs/                deployment guide, architecture, pitch video script, submission checklist
```

## Run it

### Contracts

```bash
rustup target add wasm32v1-none
cargo test                     # 25 tests: core (15) + market (10)
stellar contract build
```

### Production (mainnet)

```bash
cargo install --locked stellar-cli
stellar keys add escomblock-deployer --secret-key      # funded admin account
stellar keys add escomblock-escb-issuer --secret-key   # fresh account, locked after deploy
RPC_URL=https://<your-mainnet-rpc> \
DEPLOYER=escomblock-deployer ESCB_ISSUER=escomblock-escb-issuer \
TREASURY=G... PLANTS="G..." LABS="G..." HOME_DOMAIN=escomblock.example \
./scripts/deploy.sh mainnet
```

Then publish the printed values as GitHub repository variables; `deploy-app.yml` builds the dApp and serves it on GitHub Pages. Full guide: [docs/DEPLOY.md](docs/DEPLOY.md).

### Development

```bash
docker run -d -p 8000:8000 stellar/quickstart --local --enable-soroban-rpc
./scripts/deploy.sh local --seed          # deploys + runs one full flow with test accounts
cd app && npm install && npm run dev      # http://localhost:5173 against the local network
PLANT_SECRET=$(stellar keys show escomblock-plant) LAB_SECRET=$(stellar keys show escomblock-lab) \
BUILDER_SECRET=$(stellar keys show escomblock-builder) npm run test:it   # e2e suite
```

`./scripts/deploy.sh testnet --seed` does the same on Stellar testnet.

## Contract API (core)

| Function | Auth | Notes |
| --- | --- | --- |
| `__constructor(admin, usdc, credit, price_per_kg, standard)` | – | `credit` = ESCB SAC; call `set_admin(core)` on it afterwards |
| `set_role(account, Plant\|Lab, enabled)` / `set_params` / `set_admin` | admin | |
| `set_paused(bool)` | admin | emergency stop for all writes; views keep working |
| `upgrade(wasm_hash)` | admin | new code, same address and data |
| `record_delivery(plant, collector, kg, origin) -> id` | plant | pays `kg × price_per_kg` USDC plant → collector |
| `create_batch(plant, delivery_ids, blocks, mix) -> id` | plant | ≤ 50 deliveries, each used once, same plant |
| `certify_batch(lab, batch_id, strength_mpa_x100, absorption_pct_x100, thermal_cycles, report_hash) -> passed` | lab ≠ plant | mints `rubble_kg × 10^7` ESCB stroops on pass |
| `retire(from, amount, beneficiary) -> id` | holder | burns ESCB, keeps a permanent record |
| `passport`, `batch`, `delivery`, `certification`, `retirement`, `stats`, `counts`, `config`, `has_role`, `paused`, `batch_summary` | – | views |
| `deliveries(start, limit)`, `batches(start, limit)`, `retirements(start, limit)` | – | paged views (≤ 50 per call) |

Market: `list`, `delist`, `buy`, `ship`, `confirm`, `claim` (after `claim_after` seconds), `cancel` (before shipping); admin `set_fee`, `set_admin`, `set_paused` (stops new listings and purchases, open orders can still settle), `upgrade`; views `listing`, `order`, `listings`, `orders`, `counts`, `config`, `paused`. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The certification standard is configurable. Defaults (3.5 MPa minimum compressive strength, 12 % maximum absorption, 50 heat-humidity cycles) are reference values; a deployment should set them from the applicable norm (e.g. NMX-C-441-ONNCCE in Mexico, NCh 181/182 in Chile) with its partner lab.

## Roadmap

1. Pilot with one block plant and one university materials lab in Hermosillo; same model for Chilean cities.
2. Collector onboarding with a passkey smart wallet (no seed phrase) and cash-out through a local anchor (SEP-24).
3. Municipal dashboard: rubble diverted per neighbourhood, from the public on-chain data.
4. Sell ESCB retirements to builders who need to report waste management for green-building certifications.

## Resumen en español

**Escomblock** es un proyecto de investigación estudiantil que propone un bloque de mampostería hecho con escombro reciclado, capaz de resistir el calor y la humedad de Hermosillo, Sonora. En casi todo México el escombro no está regulado; este proyecto lo convierte en material de construcción certificado y usa **Stellar** para:

- **Pagar al instante en USDC** a quienes recolectan y entregan escombro, en la misma transacción en que se pesa.
- **Trazar cada kilo** desde la demolición hasta el bloque, con un **pasaporte público** por lote (QR en cada bloque).
- **Certificar con un laboratorio independiente** (resistencia, absorción, ciclos de calor-humedad y huella SHA-256 del informe). Solo los lotes aprobados emiten **créditos ESCB** (1 ESCB = 1 kg de escombro desviado).
- **Vender con garantía (escrow)**: la constructora paga en USDC, el pago se libera al confirmar la entrega y los ESCB de esos bloques pasan a la constructora, que puede **retirarlos** para reclamar el impacto sin doble conteo.

La app lee directamente de los contratos en **Stellar mainnet** (cualquiera puede consultar sin wallet) y firma con **Freighter**. El despliegue a producción usa el USDC oficial de Circle y bloquea la cuenta emisora de ESCB para que solo el contrato pueda emitir créditos ([docs/DEPLOY.md](docs/DEPLOY.md)). Ver [docs/PITCH.md](docs/PITCH.md) para el guion del video y [docs/SUBMISSION.md](docs/SUBMISSION.md) para la lista de entrega del hackathon.

## License

MIT
