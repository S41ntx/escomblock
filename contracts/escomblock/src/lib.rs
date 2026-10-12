#![no_std]
//! # Escomblock core contract
//!
//! Turns construction rubble ("escombro") into verifiable, paid-for building blocks:
//!
//! 1. **Delivery** — a collector (often an informal worker) drops rubble at a
//!    registered block plant. The plant records the weight and the collector is
//!    paid **instantly in USDC** inside the same transaction.
//! 2. **Batch** — the plant groups deliveries into a production batch of blocks.
//! 3. **Certification** — an independent registered lab uploads the test results
//!    (compressive strength, water absorption, thermal cycles, report hash).
//!    Batches that meet the configured standard mint **ESCB circularity credits**
//!    (1 ESCB = 1 kg of rubble diverted from landfill) to the plant through the
//!    ESCB Stellar Asset Contract, of which this contract is the admin.
//! 4. **Retirement** — anyone holding ESCB (e.g. a construction company that
//!    bought blocks) can retire credits to claim the impact. Retired credits are
//!    burned and a permanent retirement record is kept.
//!
//! Every batch exposes a public **passport** (batch + source deliveries + lab
//! results) that a QR code printed on each block can point to.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String, Vec,
};

#[cfg(test)]
mod test;

/// ESCB and USDC on Stellar both use 7 decimals.
pub const UNIT: i128 = 10_000_000;

const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const RECORD_BUMP: u32 = 180 * DAY_LEDGERS;
const BUMP_THRESHOLD: u32 = 7 * DAY_LEDGERS;
const MAX_DELIVERIES_PER_BATCH: u32 = 50;
/// Maximum records returned by one paged view call.
pub const MAX_PAGE: u32 = 50;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotPlant = 1,
    NotLab = 2,
    InvalidAmount = 3,
    DeliveryNotFound = 4,
    DeliveryAlreadyUsed = 5,
    DeliveryWrongPlant = 6,
    BatchNotFound = 7,
    BatchNotPending = 8,
    LabIsPlant = 9,
    TooManyDeliveries = 10,
    RetirementNotFound = 11,
    InvalidParams = 12,
    Paused = 13,
    RolesClosed = 14,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Role {
    Plant,
    Lab,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BatchStatus {
    Pending,
    Certified,
    Rejected,
}

/// Technical standard a batch must meet to be certified.
/// Values are scaled by 100 (e.g. 350 = 3.50 MPa, 1200 = 12.00 %).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Standard {
    pub min_strength_mpa_x100: u32,
    pub max_absorption_pct_x100: u32,
    pub min_thermal_cycles: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub usdc: Address,
    pub credit: Address,
    /// USDC paid to a collector per kg of rubble, in stroops (1e-7 USDC).
    pub price_per_kg: i128,
    pub standard: Standard,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Delivery {
    pub id: u64,
    pub plant: Address,
    pub collector: Address,
    pub kg: u64,
    /// Free-text origin, e.g. "Culiacán, Sin. - demolición Col. Centro".
    pub origin: String,
    pub payout: i128,
    pub timestamp: u64,
    /// Batch the rubble was used in (0 = not used yet).
    pub batch_id: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Certification {
    pub lab: Address,
    pub strength_mpa_x100: u32,
    pub absorption_pct_x100: u32,
    pub thermal_cycles: u32,
    /// sha256 of the full lab report (PDF), stored off-chain.
    pub report_hash: BytesN<32>,
    pub passed: bool,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Batch {
    pub id: u64,
    pub plant: Address,
    pub deliveries: Vec<u64>,
    pub rubble_kg: u64,
    pub blocks: u32,
    /// Mix design, e.g. "40% RCD + cemento CPC 30R + arena".
    pub mix: String,
    pub status: BatchStatus,
    pub created_at: u64,
    /// ESCB minted for this batch, in stroops.
    pub credits_minted: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Retirement {
    pub id: u64,
    pub by: Address,
    pub amount: i128,
    pub beneficiary: String,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Stats {
    pub deliveries: u64,
    pub rubble_kg: u64,
    pub usdc_paid: i128,
    pub batches: u64,
    pub certified_batches: u64,
    pub certified_blocks: u64,
    pub credits_minted: i128,
    pub credits_retired: i128,
    pub retirements: u64,
}

/// A batch together with its lab certification (empty while pending).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchView {
    pub batch: Batch,
    pub certification: Vec<Certification>,
}

/// Full traceability view used by the public block passport page.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Passport {
    pub batch: Batch,
    pub deliveries: Vec<Delivery>,
    /// Empty while pending, one entry once a lab has tested the batch.
    pub certification: Vec<Certification>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Stats,
    Paused,
    OpenRoles,
    NextDelivery,
    NextBatch,
    NextRetirement,
    Role(Address, Role),
    Delivery(u64),
    Batch(u64),
    Certification(u64),
    Retirement(u64),
}

// ---------------------------------------------------------------- events

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleSet {
    #[topic]
    pub account: Address,
    pub role: Role,
    pub enabled: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RubbleDelivered {
    #[topic]
    pub plant: Address,
    #[topic]
    pub collector: Address,
    pub id: u64,
    pub kg: u64,
    pub payout: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCreated {
    #[topic]
    pub plant: Address,
    pub id: u64,
    pub rubble_kg: u64,
    pub blocks: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCertified {
    #[topic]
    pub lab: Address,
    pub id: u64,
    pub passed: bool,
    pub credits: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreditsRetired {
    #[topic]
    pub by: Address,
    pub id: u64,
    pub amount: i128,
    pub beneficiary: String,
}

// ---------------------------------------------------------------- contract

#[contract]
pub struct Escomblock;

#[contractimpl]
impl Escomblock {
    /// `credit` must be the Stellar Asset Contract of the ESCB asset; after
    /// deployment its admin must be set to this contract (`set_admin`) so that
    /// certified batches can mint credits.
    pub fn __constructor(
        env: Env,
        admin: Address,
        usdc: Address,
        credit: Address,
        price_per_kg: i128,
        standard: Standard,
    ) {
        if price_per_kg < 0 {
            panic_with_error!(&env, Error::InvalidParams);
        }
        let config = Config {
            admin,
            usdc,
            credit,
            price_per_kg,
            standard,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .set(&DataKey::Stats, &Stats::default());
    }

    // ------------------------------------------------------------ admin

    pub fn set_role(env: Env, account: Address, role: Role, enabled: bool) {
        let config = Self::config(env.clone());
        config.admin.require_auth();
        let key = DataKey::Role(account.clone(), role);
        if enabled {
            env.storage().persistent().set(&key, &true);
            bump(&env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
        RoleSet {
            account,
            role,
            enabled,
        }
        .publish(&env);
        bump_instance(&env);
    }

    /// Lets any account register itself as a plant or lab with `join`.
    /// Meant for public test deployments; off unless the admin enables it.
    pub fn set_open_roles(env: Env, open: bool) {
        Self::config(env.clone()).admin.require_auth();
        env.storage().instance().set(&DataKey::OpenRoles, &open);
        bump_instance(&env);
    }

    /// Self-registration, only while open roles are enabled. A lab still
    /// cannot certify a batch from its own plant account.
    pub fn join(env: Env, account: Address, role: Role) {
        account.require_auth();
        require_active(&env);
        if !Self::open_roles(env.clone()) {
            panic_with_error!(&env, Error::RolesClosed);
        }
        let key = DataKey::Role(account.clone(), role);
        env.storage().persistent().set(&key, &true);
        bump(&env, &key);
        RoleSet {
            account,
            role,
            enabled: true,
        }
        .publish(&env);
        bump_instance(&env);
    }

    pub fn set_params(env: Env, price_per_kg: i128, standard: Standard) {
        let mut config = Self::config(env.clone());
        config.admin.require_auth();
        if price_per_kg < 0 {
            panic_with_error!(&env, Error::InvalidParams);
        }
        config.price_per_kg = price_per_kg;
        config.standard = standard;
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config = Self::config(env.clone());
        config.admin.require_auth();
        config.admin = new_admin;
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Emergency stop: blocks deliveries, batches, certifications and
    /// retirements. Views keep working.
    pub fn set_paused(env: Env, paused: bool) {
        Self::config(env.clone()).admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        bump_instance(&env);
    }

    /// Replaces the contract code, keeping its address and storage.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::config(env.clone()).admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ------------------------------------------------------------ flow

    /// Records a rubble delivery and pays the collector `kg * price_per_kg`
    /// USDC from the plant's balance, atomically.
    pub fn record_delivery(
        env: Env,
        plant: Address,
        collector: Address,
        kg: u64,
        origin: String,
    ) -> u64 {
        plant.require_auth();
        require_active(&env);
        require_role(&env, &plant, Role::Plant);
        if kg == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if collector == plant {
            panic_with_error!(&env, Error::InvalidParams);
        }
        let config = Self::config(env.clone());
        let payout = config.price_per_kg * kg as i128;
        if payout > 0 {
            TokenClient::new(&env, &config.usdc).transfer(&plant, &collector, &payout);
        }

        let id = next_id(&env, DataKey::NextDelivery);
        let delivery = Delivery {
            id,
            plant: plant.clone(),
            collector: collector.clone(),
            kg,
            origin,
            payout,
            timestamp: env.ledger().timestamp(),
            batch_id: 0,
        };
        let key = DataKey::Delivery(id);
        env.storage().persistent().set(&key, &delivery);
        bump(&env, &key);

        update_stats(&env, |s| {
            s.deliveries += 1;
            s.rubble_kg += kg;
            s.usdc_paid += payout;
        });
        RubbleDelivered {
            plant,
            collector,
            id,
            kg,
            payout,
        }
        .publish(&env);
        id
    }

    /// Groups unused deliveries of `plant` into a production batch.
    pub fn create_batch(
        env: Env,
        plant: Address,
        delivery_ids: Vec<u64>,
        blocks: u32,
        mix: String,
    ) -> u64 {
        plant.require_auth();
        require_active(&env);
        require_role(&env, &plant, Role::Plant);
        if blocks == 0 || delivery_ids.is_empty() {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if delivery_ids.len() > MAX_DELIVERIES_PER_BATCH {
            panic_with_error!(&env, Error::TooManyDeliveries);
        }

        let id = next_id(&env, DataKey::NextBatch);
        let mut rubble_kg: u64 = 0;
        for delivery_id in delivery_ids.iter() {
            let key = DataKey::Delivery(delivery_id);
            let mut delivery: Delivery = env
                .storage()
                .persistent()
                .get(&key)
                .unwrap_or_else(|| panic_with_error!(&env, Error::DeliveryNotFound));
            if delivery.plant != plant {
                panic_with_error!(&env, Error::DeliveryWrongPlant);
            }
            if delivery.batch_id != 0 {
                panic_with_error!(&env, Error::DeliveryAlreadyUsed);
            }
            delivery.batch_id = id;
            rubble_kg += delivery.kg;
            env.storage().persistent().set(&key, &delivery);
            bump(&env, &key);
        }

        let batch = Batch {
            id,
            plant: plant.clone(),
            deliveries: delivery_ids,
            rubble_kg,
            blocks,
            mix,
            status: BatchStatus::Pending,
            created_at: env.ledger().timestamp(),
            credits_minted: 0,
        };
        let key = DataKey::Batch(id);
        env.storage().persistent().set(&key, &batch);
        bump(&env, &key);

        update_stats(&env, |s| s.batches += 1);
        BatchCreated {
            plant,
            id,
            rubble_kg,
            blocks,
        }
        .publish(&env);
        id
    }

    /// Independent lab uploads test results. If the batch meets the standard,
    /// `rubble_kg` ESCB are minted to the plant. Returns whether it passed.
    pub fn certify_batch(
        env: Env,
        lab: Address,
        batch_id: u64,
        strength_mpa_x100: u32,
        absorption_pct_x100: u32,
        thermal_cycles: u32,
        report_hash: BytesN<32>,
    ) -> bool {
        lab.require_auth();
        require_active(&env);
        require_role(&env, &lab, Role::Lab);
        let key = DataKey::Batch(batch_id);
        let mut batch: Batch = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::BatchNotFound));
        if batch.status != BatchStatus::Pending {
            panic_with_error!(&env, Error::BatchNotPending);
        }
        if batch.plant == lab {
            panic_with_error!(&env, Error::LabIsPlant);
        }

        let config = Self::config(env.clone());
        let std = &config.standard;
        let passed = strength_mpa_x100 >= std.min_strength_mpa_x100
            && absorption_pct_x100 <= std.max_absorption_pct_x100
            && thermal_cycles >= std.min_thermal_cycles;

        let mut credits: i128 = 0;
        if passed {
            credits = batch.rubble_kg as i128 * UNIT;
            StellarAssetClient::new(&env, &config.credit).mint(&batch.plant, &credits);
            batch.status = BatchStatus::Certified;
            batch.credits_minted = credits;
        } else {
            batch.status = BatchStatus::Rejected;
        }
        let cert_key = DataKey::Certification(batch_id);
        let certification = Certification {
            lab: lab.clone(),
            strength_mpa_x100,
            absorption_pct_x100,
            thermal_cycles,
            report_hash,
            passed,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&cert_key, &certification);
        bump(&env, &cert_key);
        env.storage().persistent().set(&key, &batch);
        bump(&env, &key);

        if passed {
            let blocks = batch.blocks as u64;
            update_stats(&env, |s| {
                s.certified_batches += 1;
                s.certified_blocks += blocks;
                s.credits_minted += credits;
            });
        }
        BatchCertified {
            lab,
            id: batch_id,
            passed,
            credits,
        }
        .publish(&env);
        passed
    }

    /// Burns `amount` ESCB from `from` and records who claims the impact.
    pub fn retire(env: Env, from: Address, amount: i128, beneficiary: String) -> u64 {
        from.require_auth();
        require_active(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let config = Self::config(env.clone());
        TokenClient::new(&env, &config.credit).burn(&from, &amount);

        let id = next_id(&env, DataKey::NextRetirement);
        let retirement = Retirement {
            id,
            by: from.clone(),
            amount,
            beneficiary: beneficiary.clone(),
            timestamp: env.ledger().timestamp(),
        };
        let key = DataKey::Retirement(id);
        env.storage().persistent().set(&key, &retirement);
        bump(&env, &key);

        update_stats(&env, |s| {
            s.credits_retired += amount;
            s.retirements += 1;
        });
        CreditsRetired {
            by: from,
            id,
            amount,
            beneficiary,
        }
        .publish(&env);
        id
    }

    // ------------------------------------------------------------ views

    pub fn config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn stats(env: Env) -> Stats {
        env.storage()
            .instance()
            .get(&DataKey::Stats)
            .unwrap_or_default()
    }

    pub fn open_roles(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::OpenRoles)
            .unwrap_or(false)
    }

    pub fn paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Deliveries with ids `start..start + limit` (ids start at 1).
    pub fn deliveries(env: Env, start: u64, limit: u32) -> Vec<Delivery> {
        let mut out = Vec::new(&env);
        for id in page(&env, start, limit, DataKey::NextDelivery) {
            if let Some(d) = env.storage().persistent().get(&DataKey::Delivery(id)) {
                out.push_back(d);
            }
        }
        out
    }

    /// Batches with their certification, ids `start..start + limit`.
    pub fn batches(env: Env, start: u64, limit: u32) -> Vec<BatchView> {
        let mut out = Vec::new(&env);
        for id in page(&env, start, limit, DataKey::NextBatch) {
            if let Some(batch) = env.storage().persistent().get(&DataKey::Batch(id)) {
                let mut certification = Vec::new(&env);
                if let Some(c) = Self::certification(env.clone(), id) {
                    certification.push_back(c);
                }
                out.push_back(BatchView {
                    batch,
                    certification,
                });
            }
        }
        out
    }

    /// Retirements with ids `start..start + limit`.
    pub fn retirements(env: Env, start: u64, limit: u32) -> Vec<Retirement> {
        let mut out = Vec::new(&env);
        for id in page(&env, start, limit, DataKey::NextRetirement) {
            if let Some(r) = env.storage().persistent().get(&DataKey::Retirement(id)) {
                out.push_back(r);
            }
        }
        out
    }

    pub fn has_role(env: Env, account: Address, role: Role) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Role(account, role))
    }

    pub fn delivery(env: Env, id: u64) -> Delivery {
        env.storage()
            .persistent()
            .get(&DataKey::Delivery(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::DeliveryNotFound))
    }

    pub fn batch(env: Env, id: u64) -> Batch {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::BatchNotFound))
    }

    pub fn retirement(env: Env, id: u64) -> Retirement {
        env.storage()
            .persistent()
            .get(&DataKey::Retirement(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RetirementNotFound))
    }

    /// Batch + every source delivery: what the QR on a block resolves to.
    pub fn passport(env: Env, batch_id: u64) -> Passport {
        let batch = Self::batch(env.clone(), batch_id);
        let mut deliveries = Vec::new(&env);
        for id in batch.deliveries.iter() {
            deliveries.push_back(Self::delivery(env.clone(), id));
        }
        let mut certification = Vec::new(&env);
        if let Some(c) = Self::certification(env.clone(), batch_id) {
            certification.push_back(c);
        }
        Passport {
            batch,
            deliveries,
            certification,
        }
    }

    pub fn certification(env: Env, batch_id: u64) -> Option<Certification> {
        env.storage()
            .persistent()
            .get(&DataKey::Certification(batch_id))
    }

    /// Compact view for other contracts (the market):
    /// (plant, blocks, rubble_kg, certified).
    pub fn batch_summary(env: Env, batch_id: u64) -> (Address, u32, u64, bool) {
        let batch = Self::batch(env, batch_id);
        (
            batch.plant,
            batch.blocks,
            batch.rubble_kg,
            batch.status == BatchStatus::Certified,
        )
    }

    pub fn counts(env: Env) -> (u64, u64, u64) {
        let s = env.storage().instance();
        (
            s.get(&DataKey::NextDelivery).unwrap_or(0),
            s.get(&DataKey::NextBatch).unwrap_or(0),
            s.get(&DataKey::NextRetirement).unwrap_or(0),
        )
    }
}

// ---------------------------------------------------------------- helpers

fn require_active(env: &Env) {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::Paused);
    }
}

/// Ids `start..start + limit`, clamped to existing ids and `MAX_PAGE`.
fn page(env: &Env, start: u64, limit: u32, counter: DataKey) -> core::ops::Range<u64> {
    let last: u64 = env.storage().instance().get(&counter).unwrap_or(0);
    let first = start.max(1);
    let limit = limit.min(MAX_PAGE) as u64;
    if limit == 0 || first > last {
        return 0..0;
    }
    first..(last + 1).min(first + limit)
}

fn require_role(env: &Env, account: &Address, role: Role) {
    if !env
        .storage()
        .persistent()
        .has(&DataKey::Role(account.clone(), role))
    {
        match role {
            Role::Plant => panic_with_error!(env, Error::NotPlant),
            Role::Lab => panic_with_error!(env, Error::NotLab),
        }
    }
}

/// Ids start at 1 so that 0 can mean "none".
fn next_id(env: &Env, key: DataKey) -> u64 {
    let id: u64 = env.storage().instance().get(&key).unwrap_or(0) + 1;
    env.storage().instance().set(&key, &id);
    id
}

fn update_stats(env: &Env, f: impl FnOnce(&mut Stats)) {
    let mut stats: Stats = env
        .storage()
        .instance()
        .get(&DataKey::Stats)
        .unwrap_or_default();
    f(&mut stats);
    env.storage().instance().set(&DataKey::Stats, &stats);
    bump_instance(env);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, RECORD_BUMP);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, INSTANCE_BUMP);
}
