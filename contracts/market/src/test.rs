#![cfg(test)]
extern crate std;

use super::*;
use escomblock::{Escomblock, EscomblockClient, Role, Standard};
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

const WEEK: u64 = 7 * 24 * 3600;

struct Setup<'a> {
    env: Env,
    core: EscomblockClient<'a>,
    market: MarketClient<'a>,
    usdc: TokenClient<'a>,
    escb: TokenClient<'a>,
    plant: Address,
    lab: Address,
    buyer: Address,
    treasury: Address,
    batch_id: u64,
}

fn setup<'a>(certify: bool) -> Setup<'a> {
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
            50_000i128,
            Standard {
                min_strength_mpa_x100: 350,
                max_absorption_pct_x100: 1200,
                min_thermal_cycles: 50,
            },
        ),
    );
    let core = EscomblockClient::new(&env, &core_id);
    StellarAssetClient::new(&env, &escb_sac.address()).set_admin(&core_id);

    let treasury = Address::generate(&env);
    let market_id = env.register(
        Market,
        (
            admin.clone(),
            core_id.clone(),
            usdc_sac.address(),
            escb_sac.address(),
            treasury.clone(),
            200u32, // 2 % to the collectors' fund
            WEEK,
        ),
    );
    let market = MarketClient::new(&env, &market_id);

    let plant = Address::generate(&env);
    let lab = Address::generate(&env);
    let buyer = Address::generate(&env);
    let collector = Address::generate(&env);
    core.set_role(&plant, &Role::Plant, &true);
    core.set_role(&lab, &Role::Lab, &true);
    let usdc_admin = StellarAssetClient::new(&env, &usdc_sac.address());
    usdc_admin.mint(&plant, &(1_000 * UNIT));
    usdc_admin.mint(&buyer, &(10_000 * UNIT));

    let d = core.record_delivery(&plant, &collector, &4_000, &String::from_str(&env, "x"));
    // 4 000 kg of rubble -> 1 000 blocks -> 4 ESCB per block
    let batch_id = core.create_batch(
        &plant,
        &vec![&env, d],
        &1_000,
        &String::from_str(&env, "40% RCD"),
    );
    if certify {
        core.certify_batch(
            &lab,
            &batch_id,
            &500,
            &900,
            &60,
            &BytesN::from_array(&env, &[1; 32]),
        );
    }

    Setup {
        usdc: TokenClient::new(&env, &usdc_sac.address()),
        escb: TokenClient::new(&env, &escb_sac.address()),
        env,
        core,
        market,
        plant,
        lab,
        buyer,
        treasury,
        batch_id,
    }
}

const PRICE: i128 = 12 * UNIT / 10; // 1.2 USDC per block

#[test]
fn list_buy_ship_confirm() {
    let t = setup(true);
    let l = t.market.list(&t.plant, &t.batch_id, &600, &PRICE);
    // 600 blocks * 4 ESCB escrowed
    assert_eq!(t.escb.balance(&t.market.address), 2_400 * UNIT);
    assert_eq!(t.escb.balance(&t.plant), 1_600 * UNIT);

    let o = t.market.buy(&t.buyer, &l, &100);
    assert_eq!(t.usdc.balance(&t.market.address), 120 * UNIT);
    assert_eq!(t.market.listing(&l).available, 500);

    t.market.ship(&t.plant, &o);
    let plant_usdc_before = t.usdc.balance(&t.plant);
    t.market.confirm(&t.buyer, &o);

    let fee = 120 * UNIT * 200 / 10_000;
    assert_eq!(t.usdc.balance(&t.treasury), fee);
    assert_eq!(
        t.usdc.balance(&t.plant),
        plant_usdc_before + 120 * UNIT - fee
    );
    assert_eq!(t.escb.balance(&t.buyer), 400 * UNIT);
    assert_eq!(t.market.order(&o).status, OrderStatus::Completed);

    // The builder can now retire the impact that came with its blocks.
    t.core.retire(
        &t.buyer,
        &(400 * UNIT),
        &String::from_str(&t.env, "Torre Pitic"),
    );
    assert_eq!(t.escb.balance(&t.buyer), 0);
    assert_eq!(t.market.counts(), (1, 1));
}

#[test]
fn cannot_list_uncertified_batch() {
    let t = setup(false);
    let res = t.market.try_list(&t.plant, &t.batch_id, &10, &PRICE);
    assert_eq!(res, Err(Ok(e(Error::NotCertified))));
}

#[test]
fn only_owner_lists_and_never_more_than_produced() {
    let t = setup(true);
    assert_eq!(
        t.market.try_list(&t.lab, &t.batch_id, &10, &PRICE),
        Err(Ok(e(Error::NotBatchOwner)))
    );
    t.market.list(&t.plant, &t.batch_id, &900, &PRICE);
    assert_eq!(
        t.market.try_list(&t.plant, &t.batch_id, &101, &PRICE),
        Err(Ok(e(Error::NotEnoughBlocks)))
    );
    t.market.list(&t.plant, &t.batch_id, &100, &PRICE);
}

#[test]
fn cancel_before_shipping_refunds() {
    let t = setup(true);
    let l = t.market.list(&t.plant, &t.batch_id, &100, &PRICE);
    let o = t.market.buy(&t.buyer, &l, &50);
    t.market.cancel(&t.buyer, &o);
    assert_eq!(t.usdc.balance(&t.buyer), 10_000 * UNIT);
    assert_eq!(t.market.listing(&l).available, 100);
    assert_eq!(t.market.order(&o).status, OrderStatus::Cancelled);
}

#[test]
fn cannot_cancel_after_shipping() {
    let t = setup(true);
    let l = t.market.list(&t.plant, &t.batch_id, &100, &PRICE);
    let o = t.market.buy(&t.buyer, &l, &50);
    t.market.ship(&t.plant, &o);
    assert_eq!(
        t.market.try_cancel(&t.buyer, &o),
        Err(Ok(e(Error::BadStatus)))
    );
}

#[test]
fn seller_claims_after_timeout() {
    let t = setup(true);
    let l = t.market.list(&t.plant, &t.batch_id, &100, &PRICE);
    let o = t.market.buy(&t.buyer, &l, &10);
    t.market.ship(&t.plant, &o);
    assert_eq!(
        t.market.try_claim(&t.plant, &o),
        Err(Ok(e(Error::TooEarly)))
    );
    t.env
        .ledger()
        .set_timestamp(t.env.ledger().timestamp() + WEEK + 1);
    t.market.claim(&t.plant, &o);
    assert_eq!(t.market.order(&o).status, OrderStatus::Completed);
    assert_eq!(t.escb.balance(&t.buyer), 40 * UNIT);
}

#[test]
fn delist_returns_unsold_credits() {
    let t = setup(true);
    let l = t.market.list(&t.plant, &t.batch_id, &100, &PRICE);
    let o = t.market.buy(&t.buyer, &l, &25);
    t.market.delist(&t.plant, &l);
    // 75 unsold blocks * 4 ESCB back; 25 * 4 stay for the open order.
    assert_eq!(t.escb.balance(&t.market.address), 100 * UNIT);
    assert_eq!(
        t.market.try_buy(&t.buyer, &l, &1),
        Err(Ok(e(Error::ListingClosed)))
    );
    // Cancelling the open order now returns its credits to the seller.
    t.market.cancel(&t.buyer, &o);
    assert_eq!(t.escb.balance(&t.market.address), 0);
    assert_eq!(t.escb.balance(&t.plant), 4_000 * UNIT);
    // All 1 000 blocks can be listed again.
    t.market.list(&t.plant, &t.batch_id, &1_000, &PRICE);
}

#[test]
fn guards() {
    let t = setup(true);
    let l = t.market.list(&t.plant, &t.batch_id, &100, &PRICE);
    assert_eq!(
        t.market.try_buy(&t.plant, &l, &1),
        Err(Ok(e(Error::SelfPurchase)))
    );
    assert_eq!(
        t.market.try_buy(&t.buyer, &l, &101),
        Err(Ok(e(Error::NotEnoughBlocks)))
    );
    let o = t.market.buy(&t.buyer, &l, &1);
    assert_eq!(
        t.market.try_ship(&t.buyer, &o),
        Err(Ok(e(Error::NotSeller)))
    );
    assert_eq!(
        t.market.try_confirm(&t.plant, &o),
        Err(Ok(e(Error::NotBuyer)))
    );
}
