#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, String,
};

/// Contract errors surface as `soroban_sdk::Error` because functions panic
/// with `panic_with_error!` instead of returning `Result`.
fn e(err: Error) -> soroban_sdk::Error {
    err.into()
}

const PRICE_PER_KG: i128 = 50_000; // 0.005 USDC per kg -> 5 USDC per tonne

struct Setup<'a> {
    env: Env,
    core: EscomblockClient<'a>,
    usdc: TokenClient<'a>,
    escb: TokenClient<'a>,
    plant: Address,
    lab: Address,
    collector: Address,
}

fn standard() -> Standard {
    Standard {
        min_strength_mpa_x100: 350,    // 3.5 MPa
        max_absorption_pct_x100: 1200, // 12 %
        min_thermal_cycles: 50,
    }
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_760_000_000);

    let admin = Address::generate(&env);
    let usdc_sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let escb_sac = env.register_stellar_asset_contract_v2(admin.clone());

    let core_id = env.register(
        Escomblock,
        (
            admin.clone(),
            usdc_sac.address(),
            escb_sac.address(),
            PRICE_PER_KG,
            standard(),
        ),
    );
    let core = EscomblockClient::new(&env, &core_id);
    // The core contract becomes the ESCB issuer admin so it can mint credits.
    StellarAssetClient::new(&env, &escb_sac.address()).set_admin(&core_id);

    let plant = Address::generate(&env);
    let lab = Address::generate(&env);
    let collector = Address::generate(&env);
    core.set_role(&plant, &Role::Plant, &true);
    core.set_role(&lab, &Role::Lab, &true);

    StellarAssetClient::new(&env, &usdc_sac.address()).mint(&plant, &(1_000 * UNIT));

    Setup {
        usdc: TokenClient::new(&env, &usdc_sac.address()),
        escb: TokenClient::new(&env, &escb_sac.address()),
        env,
        core,
        plant,
        lab,
        collector,
    }
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

#[test]
fn delivery_pays_collector_instantly() {
    let t = setup();
    let id = t
        .core
        .record_delivery(&t.plant, &t.collector, &2_000, &s(&t.env, "Hermosillo"));
    assert_eq!(id, 1);
    assert_eq!(t.usdc.balance(&t.collector), 2_000 * PRICE_PER_KG); // 10 USDC
    assert_eq!(
        t.usdc.balance(&t.plant),
        1_000 * UNIT - 2_000 * PRICE_PER_KG
    );

    let d = t.core.delivery(&id);
    assert_eq!(d.kg, 2_000);
    assert_eq!(d.batch_id, 0);
    let stats = t.core.stats();
    assert_eq!(stats.deliveries, 1);
    assert_eq!(stats.rubble_kg, 2_000);
    assert_eq!(stats.usdc_paid, 2_000 * PRICE_PER_KG);
}

#[test]
fn full_flow_certify_mint_and_retire() {
    let t = setup();
    let d1 = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_500, &s(&t.env, "Obra A"));
    let d2 = t
        .core
        .record_delivery(&t.plant, &t.collector, &500, &s(&t.env, "Obra B"));
    let batch_id =
        t.core
            .create_batch(&t.plant, &vec![&t.env, d1, d2], &400, &s(&t.env, "40% RCD"));
    assert_eq!(t.core.delivery(&d1).batch_id, batch_id);

    let passed = t
        .core
        .certify_batch(&t.lab, &batch_id, &520, &980, &60, &hash(&t.env));
    assert!(passed);

    let batch = t.core.batch(&batch_id);
    assert_eq!(batch.status, BatchStatus::Certified);
    assert_eq!(batch.rubble_kg, 2_000);
    assert_eq!(batch.credits_minted, 2_000 * UNIT);
    assert_eq!(t.escb.balance(&t.plant), 2_000 * UNIT);

    let passport = t.core.passport(&batch_id);
    assert_eq!(passport.deliveries.len(), 2);
    assert_eq!(
        passport.certification.get(0).unwrap().strength_mpa_x100,
        520
    );

    let (plant, blocks, kg, certified) = t.core.batch_summary(&batch_id);
    assert_eq!(
        (plant, blocks, kg, certified),
        (t.plant.clone(), 400, 2_000, true)
    );

    let rid = t
        .core
        .retire(&t.plant, &(500 * UNIT), &s(&t.env, "Constructora Sonora"));
    assert_eq!(t.escb.balance(&t.plant), 1_500 * UNIT);
    let r = t.core.retirement(&rid);
    assert_eq!(r.amount, 500 * UNIT);

    let stats = t.core.stats();
    assert_eq!(stats.certified_blocks, 400);
    assert_eq!(stats.credits_minted, 2_000 * UNIT);
    assert_eq!(stats.credits_retired, 500 * UNIT);
    assert_eq!(t.core.counts(), (2, 1, 1));
}

#[test]
fn failing_lab_test_rejects_without_minting() {
    let t = setup();
    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    let b = t
        .core
        .create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "60% RCD"));
    // 2.8 MPa < 3.5 MPa minimum
    let passed = t
        .core
        .certify_batch(&t.lab, &b, &280, &900, &60, &hash(&t.env));
    assert!(!passed);
    assert_eq!(t.core.batch(&b).status, BatchStatus::Rejected);
    assert_eq!(t.escb.balance(&t.plant), 0);
    assert_eq!(t.core.stats().certified_batches, 0);
}

#[test]
fn hot_climate_standard_requires_thermal_cycles() {
    let t = setup();
    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    let b = t
        .core
        .create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix"));
    // Strong and dry but only 10 heat/wet cycles survived.
    assert!(!t
        .core
        .certify_batch(&t.lab, &b, &600, &800, &10, &hash(&t.env)));
}

#[test]
fn delivery_cannot_be_reused() {
    let t = setup();
    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    t.core
        .create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix"));
    let res = t
        .core
        .try_create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix"));
    assert_eq!(res, Err(Ok(e(Error::DeliveryAlreadyUsed))));
}

#[test]
fn plant_cannot_use_other_plants_rubble() {
    let t = setup();
    let other = Address::generate(&t.env);
    t.core.set_role(&other, &Role::Plant, &true);
    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    let res = t
        .core
        .try_create_batch(&other, &vec![&t.env, d], &100, &s(&t.env, "mix"));
    assert_eq!(res, Err(Ok(e(Error::DeliveryWrongPlant))));
}

#[test]
fn only_registered_actors() {
    let t = setup();
    let stranger = Address::generate(&t.env);
    let res = t
        .core
        .try_record_delivery(&stranger, &t.collector, &10, &s(&t.env, "x"));
    assert_eq!(res, Err(Ok(e(Error::NotPlant))));

    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    let b = t
        .core
        .create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix"));
    let res = t
        .core
        .try_certify_batch(&stranger, &b, &600, &800, &60, &hash(&t.env));
    assert_eq!(res, Err(Ok(e(Error::NotLab))));
}

#[test]
fn plant_cannot_certify_itself() {
    let t = setup();
    t.core.set_role(&t.plant, &Role::Lab, &true);
    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    let b = t
        .core
        .create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix"));
    let res = t
        .core
        .try_certify_batch(&t.plant, &b, &600, &800, &60, &hash(&t.env));
    assert_eq!(res, Err(Ok(e(Error::LabIsPlant))));
}

#[test]
fn batch_cannot_be_certified_twice() {
    let t = setup();
    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    let b = t
        .core
        .create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix"));
    t.core
        .certify_batch(&t.lab, &b, &600, &800, &60, &hash(&t.env));
    let res = t
        .core
        .try_certify_batch(&t.lab, &b, &600, &800, &60, &hash(&t.env));
    assert_eq!(res, Err(Ok(e(Error::BatchNotPending))));
    assert_eq!(t.escb.balance(&t.plant), 1_000 * UNIT);
}

#[test]
fn revoked_role_blocks_actions() {
    let t = setup();
    t.core.set_role(&t.plant, &Role::Plant, &false);
    assert!(!t.core.has_role(&t.plant, &Role::Plant));
    let res = t
        .core
        .try_record_delivery(&t.plant, &t.collector, &10, &s(&t.env, "x"));
    assert_eq!(res, Err(Ok(e(Error::NotPlant))));
}

#[test]
fn rejects_invalid_inputs() {
    let t = setup();
    assert_eq!(
        t.core
            .try_record_delivery(&t.plant, &t.collector, &0, &s(&t.env, "x")),
        Err(Ok(e(Error::InvalidAmount)))
    );
    assert_eq!(
        t.core
            .try_record_delivery(&t.plant, &t.plant, &10, &s(&t.env, "x")),
        Err(Ok(e(Error::InvalidParams)))
    );
    assert_eq!(
        t.core.try_retire(&t.plant, &0, &s(&t.env, "x")),
        Err(Ok(e(Error::InvalidAmount)))
    );
}

#[test]
fn admin_can_update_price_and_standard() {
    let t = setup();
    let mut std2 = standard();
    std2.min_strength_mpa_x100 = 700;
    t.core.set_params(&100_000, &std2);
    let cfg = t.core.config();
    assert_eq!(cfg.price_per_kg, 100_000);
    assert_eq!(cfg.standard.min_strength_mpa_x100, 700);
    t.core
        .record_delivery(&t.plant, &t.collector, &100, &s(&t.env, "x"));
    assert_eq!(t.usdc.balance(&t.collector), 100 * 100_000);
}

#[test]
fn pause_blocks_writes_but_not_reads() {
    let t = setup();
    let d = t
        .core
        .record_delivery(&t.plant, &t.collector, &1_000, &s(&t.env, "x"));
    t.core.set_paused(&true);
    assert!(t.core.paused());
    assert_eq!(
        t.core
            .try_record_delivery(&t.plant, &t.collector, &10, &s(&t.env, "x")),
        Err(Ok(e(Error::Paused)))
    );
    assert_eq!(
        t.core
            .try_create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix")),
        Err(Ok(e(Error::Paused)))
    );
    assert_eq!(t.core.delivery(&d).kg, 1_000);
    t.core.set_paused(&false);
    t.core
        .create_batch(&t.plant, &vec![&t.env, d], &100, &s(&t.env, "mix"));
}

#[test]
fn paged_views() {
    let t = setup();
    for kg in 1..=7u64 {
        t.core
            .record_delivery(&t.plant, &t.collector, &(kg * 100), &s(&t.env, "x"));
    }
    let b = t
        .core
        .create_batch(&t.plant, &vec![&t.env, 1, 2], &50, &s(&t.env, "mix"));
    t.core
        .certify_batch(&t.lab, &b, &600, &800, &60, &hash(&t.env));
    t.core.retire(&t.plant, &UNIT, &s(&t.env, "a"));

    let page = t.core.deliveries(&3, &3);
    assert_eq!(page.len(), 3);
    assert_eq!(page.get(0).unwrap().id, 3);
    assert_eq!(page.get(2).unwrap().id, 5);
    assert_eq!(t.core.deliveries(&6, &10).len(), 2);
    assert_eq!(t.core.deliveries(&0, &2).get(0).unwrap().id, 1);
    assert_eq!(t.core.deliveries(&8, &10).len(), 0);
    assert_eq!(t.core.deliveries(&1, &0).len(), 0);

    let batches = t.core.batches(&1, &10);
    assert_eq!(batches.len(), 1);
    assert_eq!(batches.get(0).unwrap().certification.len(), 1);
    assert_eq!(t.core.retirements(&1, &10).len(), 1);
}

#[test]
fn page_size_is_capped() {
    let t = setup();
    for _ in 0..(MAX_PAGE + 5) {
        t.core
            .record_delivery(&t.plant, &t.collector, &1, &s(&t.env, "x"));
    }
    assert_eq!(t.core.deliveries(&1, &1_000).len(), MAX_PAGE);
}
