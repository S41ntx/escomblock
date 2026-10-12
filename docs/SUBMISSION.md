# Submission checklist

## How the project maps to the judging criteria (General Track)

| Criterion | Where it shows |
| --- | --- |
| **Technical execution** | Two Soroban contracts (SDK 27) with 25 tests, upgrade + emergency pause, paged views; end-to-end suite that deploys to a real Stellar network in CI and drives the dApp's code through the full flow; one-command mainnet deploy with locked ESCB issuer and SEP-1 `stellar.toml`; GitHub Pages deploy. |
| **Meaningful use of Stellar** | USDC payouts through SAC inside the business transaction; ESCB as a classic Stellar asset whose SAC admin is the contract; escrow; burn-on-retire; cross-contract call market → core; contract events; Freighter signing. |
| **Originality** | Starts from real materials research (rubble masonry block for a hot climate) and ties physical lab certification to on-chain credit issuance and a per-block QR passport. |
| **Potential impact** | Pays informal collectors instantly, keeps rubble out of riverbeds and lots, gives builders verifiable recycled material. Categories: payments, financial inclusion, tokenization, smart contracts, public goods. |
| **User experience** | Anyone can browse every batch, payout and passport without a wallet; one-click USDC/ESCB trustlines; clear errors in Spanish; live pass/fail gauges in the lab form, Spanish UI for the target users, phone-friendly layout, light/dark themes. |
| **Presentation quality** | README (EN/ES), architecture doc with diagram, video script, pitch deck. |

## Before submitting

- [ ] `./scripts/deploy.sh mainnet` (see [DEPLOY.md](DEPLOY.md)) and paste the core and market contract ids below.
- [ ] Set the GitHub repository variables and run the **Deploy app** workflow (GitHub Pages).
- [ ] Record the pitch video following [PITCH.md](PITCH.md) and upload it (YouTube unlisted or Loom).
- [ ] Repo public, README links working.
- [ ] Team names, university and contact in the form.

| Item | Value |
| --- | --- |
| Core contract (mainnet) | `C…` |
| Market contract (mainnet) | `C…` |
| Live dApp | `https://…` |
| Video | `https://…` |

## University Track eligibility

The University Track is for students **currently enrolled at a university in Chile**. Escomblock's research context is Hermosillo, Mexico. Confirm that at least one team member meets the enrollment requirement before entering this track; if not, enter the General Track only. If the team is in Chile, consider adding a Chilean pilot city to the pitch (the rubble problem and the circular-construction agenda are shared), and keep the Hermosillo origin story.
