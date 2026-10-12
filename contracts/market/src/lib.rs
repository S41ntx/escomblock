#![no_std]
//! # Escomblock market
//!
//! Escrowed marketplace for **certified** recycled-rubble blocks.
//!
//! * A plant lists blocks from a batch the core contract has certified. The
//!   ESCB credits that correspond to those blocks
//!   (`rubble_kg * UNIT / blocks` per block) are escrowed in the market, so
//!   every block sold carries its verified impact with it.
//! * A builder buys: USDC is locked in the market.
//! * The plant marks the order as shipped; the buyer confirms reception and
//!   the market releases USDC to the plant (minus a small fee to the treasury,
//!   e.g. a collectors' fund) and ESCB to the buyer.
//! * Buyer can cancel (full refund) until the order ships. If the buyer never
//!   confirms, the plant can claim after `claim_after` seconds.

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token::TokenClient, Address, BytesN, Env, Vec,
};

#[cfg(test)]
mod test;

const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const RECORD_BUMP: u32 = 180 * DAY_LEDGERS;
const BUMP_THRESHOLD: u32 = 7 * DAY_LEDGERS;
const MAX_FEE_BPS: u32 = 1_000;
const UNIT: i128 = 10_000_000;
const MAX_PAGE: u32 = 50;

/// Minimal view of the Escomblock core contract.
#[allow(dead_code)]
#[contractclient(name = "CoreClient")]
pub trait Core {
    fn batch_summary(env: Env, batch_id: u64) -> (Address, u32, u64, bool);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotCertified = 1,
    NotBatchOwner = 2,
    InvalidAmount = 3,
    NotEnoughBlocks = 4,
    ListingNotFound = 5,
    ListingClosed = 6,
    OrderNotFound = 7,
    NotBuyer = 8,
    NotSeller = 9,
    BadStatus = 10,
    TooEarly = 11,
    InvalidParams = 12,
    SelfPurchase = 13,
    Paused = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketConfig {
    pub admin: Address,
    pub core: Address,
    pub usdc: Address,
    pub credit: Address,
    pub treasury: Address,
    pub fee_bps: u32,
    /// Seconds after shipping before the seller may claim an unconfirmed order.
    pub claim_after: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Listing {
    pub id: u64,
    pub seller: Address,
    pub batch_id: u64,
    pub price_per_block: i128,
    pub credits_per_block: i128,
    pub available: u32,
    pub sold: u32,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Paid,
    Shipped,
    Completed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub id: u64,
    pub listing_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub qty: u32,
    pub total: i128,
    pub credits: i128,
    pub status: OrderStatus,
    pub created_at: u64,
    pub shipped_at: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Paused,
    NextListing,
    NextOrder,
    Listing(u64),
    Order(u64),
    /// Blocks of a batch already listed (to never list more than produced).
    Listed(u64),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Listed {
    #[topic]
    pub seller: Address,
    pub listing_id: u64,
    pub batch_id: u64,
    pub qty: u32,
    pub price_per_block: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderUpdated {
    #[topic]
    pub buyer: Address,
    #[topic]
    pub seller: Address,
    pub order_id: u64,
    pub status: OrderStatus,
}

#[contract]
pub struct Market;

#[contractimpl]
impl Market {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        core: Address,
        usdc: Address,
        credit: Address,
        treasury: Address,
        fee_bps: u32,
        claim_after: u64,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::InvalidParams);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &MarketConfig {
                admin,
                core,
                usdc,
                credit,
                treasury,
                fee_bps,
                claim_after,
            },
        );
    }

    pub fn set_fee(env: Env, fee_bps: u32, treasury: Address) {
        let mut c = Self::config(env.clone());
        c.admin.require_auth();
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::InvalidParams);
        }
        c.fee_bps = fee_bps;
        c.treasury = treasury;
        env.storage().instance().set(&DataKey::Config, &c);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let mut c = Self::config(env.clone());
        c.admin.require_auth();
        c.admin = new_admin;
        env.storage().instance().set(&DataKey::Config, &c);
    }

    /// Emergency stop for new listings and purchases. Open orders can still
    /// be shipped, confirmed, claimed or cancelled, and listings closed, so
    /// nobody's funds get stuck.
    pub fn set_paused(env: Env, paused: bool) {
        Self::config(env.clone()).admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    pub fn paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Replaces the contract code, keeping its address and storage.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::config(env.clone()).admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Lists `qty` blocks of a certified batch and escrows their ESCB credits.
    pub fn list(env: Env, seller: Address, batch_id: u64, qty: u32, price_per_block: i128) -> u64 {
        seller.require_auth();
        if Self::paused(env.clone()) {
            panic_with_error!(&env, Error::Paused);
        }
        if qty == 0 || price_per_block <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let c = Self::config(env.clone());
        let (plant, blocks, rubble_kg, certified) =
            CoreClient::new(&env, &c.core).batch_summary(&batch_id);
        if !certified {
            panic_with_error!(&env, Error::NotCertified);
        }
        if plant != seller {
            panic_with_error!(&env, Error::NotBatchOwner);
        }
        let listed_key = DataKey::Listed(batch_id);
        let listed: u32 = env.storage().persistent().get(&listed_key).unwrap_or(0);
        if listed + qty > blocks {
            panic_with_error!(&env, Error::NotEnoughBlocks);
        }
        env.storage().persistent().set(&listed_key, &(listed + qty));
        bump(&env, &listed_key);

        let credits_per_block = rubble_kg as i128 * UNIT / blocks as i128;
        let escrow = credits_per_block * qty as i128;
        if escrow > 0 {
            TokenClient::new(&env, &c.credit).transfer(
                &seller,
                env.current_contract_address(),
                &escrow,
            );
        }

        let id = next_id(&env, DataKey::NextListing);
        let listing = Listing {
            id,
            seller: seller.clone(),
            batch_id,
            price_per_block,
            credits_per_block,
            available: qty,
            sold: 0,
            active: true,
        };
        save_listing(&env, &listing);
        Listed {
            seller,
            listing_id: id,
            batch_id,
            qty,
            price_per_block,
        }
        .publish(&env);
        id
    }

    /// Closes a listing and returns the escrowed credits of unsold blocks.
    pub fn delist(env: Env, seller: Address, listing_id: u64) {
        seller.require_auth();
        let mut listing = Self::listing(env.clone(), listing_id);
        if listing.seller != seller {
            panic_with_error!(&env, Error::NotSeller);
        }
        if !listing.active {
            panic_with_error!(&env, Error::ListingClosed);
        }
        let c = Self::config(env.clone());
        let refund = listing.credits_per_block * listing.available as i128;
        if refund > 0 {
            TokenClient::new(&env, &c.credit).transfer(
                &env.current_contract_address(),
                &seller,
                &refund,
            );
        }
        let listed_key = DataKey::Listed(listing.batch_id);
        let listed: u32 = env.storage().persistent().get(&listed_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&listed_key, &(listed - listing.available));
        listing.available = 0;
        listing.active = false;
        save_listing(&env, &listing);
    }

    /// Buys `qty` blocks; the USDC total is held in escrow.
    pub fn buy(env: Env, buyer: Address, listing_id: u64, qty: u32) -> u64 {
        buyer.require_auth();
        if Self::paused(env.clone()) {
            panic_with_error!(&env, Error::Paused);
        }
        let mut listing = Self::listing(env.clone(), listing_id);
        if !listing.active {
            panic_with_error!(&env, Error::ListingClosed);
        }
        if listing.seller == buyer {
            panic_with_error!(&env, Error::SelfPurchase);
        }
        if qty == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if qty > listing.available {
            panic_with_error!(&env, Error::NotEnoughBlocks);
        }
        let c = Self::config(env.clone());
        let total = listing.price_per_block * qty as i128;
        TokenClient::new(&env, &c.usdc).transfer(&buyer, env.current_contract_address(), &total);

        listing.available -= qty;
        listing.sold += qty;
        save_listing(&env, &listing);

        let id = next_id(&env, DataKey::NextOrder);
        let order = Order {
            id,
            listing_id,
            buyer: buyer.clone(),
            seller: listing.seller.clone(),
            qty,
            total,
            credits: listing.credits_per_block * qty as i128,
            status: OrderStatus::Paid,
            created_at: env.ledger().timestamp(),
            shipped_at: 0,
        };
        save_order(&env, &order);
        emit(&env, &order);
        id
    }

    pub fn ship(env: Env, seller: Address, order_id: u64) {
        seller.require_auth();
        let mut order = Self::order(env.clone(), order_id);
        if order.seller != seller {
            panic_with_error!(&env, Error::NotSeller);
        }
        if order.status != OrderStatus::Paid {
            panic_with_error!(&env, Error::BadStatus);
        }
        order.status = OrderStatus::Shipped;
        order.shipped_at = env.ledger().timestamp();
        save_order(&env, &order);
        emit(&env, &order);
    }

    /// Buyer confirms reception: USDC to seller (minus fee), ESCB to buyer.
    pub fn confirm(env: Env, buyer: Address, order_id: u64) {
        buyer.require_auth();
        let order = Self::order(env.clone(), order_id);
        if order.buyer != buyer {
            panic_with_error!(&env, Error::NotBuyer);
        }
        if order.status != OrderStatus::Shipped && order.status != OrderStatus::Paid {
            panic_with_error!(&env, Error::BadStatus);
        }
        settle(&env, order);
    }

    /// Seller claims an order the buyer never confirmed after `claim_after`.
    pub fn claim(env: Env, seller: Address, order_id: u64) {
        seller.require_auth();
        let order = Self::order(env.clone(), order_id);
        if order.seller != seller {
            panic_with_error!(&env, Error::NotSeller);
        }
        if order.status != OrderStatus::Shipped {
            panic_with_error!(&env, Error::BadStatus);
        }
        let c = Self::config(env.clone());
        if env.ledger().timestamp() < order.shipped_at + c.claim_after {
            panic_with_error!(&env, Error::TooEarly);
        }
        settle(&env, order);
    }

    /// Buyer cancels before shipping: full USDC refund, blocks back on sale.
    pub fn cancel(env: Env, buyer: Address, order_id: u64) {
        buyer.require_auth();
        let mut order = Self::order(env.clone(), order_id);
        if order.buyer != buyer {
            panic_with_error!(&env, Error::NotBuyer);
        }
        if order.status != OrderStatus::Paid {
            panic_with_error!(&env, Error::BadStatus);
        }
        let c = Self::config(env.clone());
        TokenClient::new(&env, &c.usdc).transfer(
            &env.current_contract_address(),
            &buyer,
            &order.total,
        );
        let mut listing = Self::listing(env.clone(), order.listing_id);
        listing.sold -= order.qty;
        if listing.active {
            listing.available += order.qty;
        } else {
            // Listing was closed meanwhile: hand the credits back to the seller.
            TokenClient::new(&env, &c.credit).transfer(
                &env.current_contract_address(),
                &order.seller,
                &order.credits,
            );
            let listed_key = DataKey::Listed(listing.batch_id);
            let listed: u32 = env.storage().persistent().get(&listed_key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&listed_key, &(listed - order.qty));
        }
        save_listing(&env, &listing);
        order.status = OrderStatus::Cancelled;
        save_order(&env, &order);
        emit(&env, &order);
    }

    // ------------------------------------------------------------ views

    pub fn config(env: Env) -> MarketConfig {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn listing(env: Env, id: u64) -> Listing {
        env.storage()
            .persistent()
            .get(&DataKey::Listing(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::ListingNotFound))
    }

    pub fn order(env: Env, id: u64) -> Order {
        env.storage()
            .persistent()
            .get(&DataKey::Order(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::OrderNotFound))
    }

    /// Listings with ids `start..start + limit` (ids start at 1).
    pub fn listings(env: Env, start: u64, limit: u32) -> Vec<Listing> {
        let mut out = Vec::new(&env);
        for id in page(&env, start, limit, DataKey::NextListing) {
            if let Some(l) = env.storage().persistent().get(&DataKey::Listing(id)) {
                out.push_back(l);
            }
        }
        out
    }

    /// Orders with ids `start..start + limit`.
    pub fn orders(env: Env, start: u64, limit: u32) -> Vec<Order> {
        let mut out = Vec::new(&env);
        for id in page(&env, start, limit, DataKey::NextOrder) {
            if let Some(o) = env.storage().persistent().get(&DataKey::Order(id)) {
                out.push_back(o);
            }
        }
        out
    }

    /// (listings, orders) created so far; ids run from 1 to these values.
    pub fn counts(env: Env) -> (u64, u64) {
        let s = env.storage().instance();
        (
            s.get(&DataKey::NextListing).unwrap_or(0),
            s.get(&DataKey::NextOrder).unwrap_or(0),
        )
    }
}

fn page(env: &Env, start: u64, limit: u32, counter: DataKey) -> core::ops::Range<u64> {
    let last: u64 = env.storage().instance().get(&counter).unwrap_or(0);
    let first = start.max(1);
    let limit = limit.min(MAX_PAGE) as u64;
    if limit == 0 || first > last {
        return 0..0;
    }
    first..(last + 1).min(first + limit)
}

fn settle(env: &Env, mut order: Order) {
    let c: MarketConfig = env.storage().instance().get(&DataKey::Config).unwrap();
    let me = env.current_contract_address();
    let usdc = TokenClient::new(env, &c.usdc);
    let fee = order.total * c.fee_bps as i128 / 10_000;
    if fee > 0 {
        usdc.transfer(&me, &c.treasury, &fee);
    }
    usdc.transfer(&me, &order.seller, &(order.total - fee));
    if order.credits > 0 {
        TokenClient::new(env, &c.credit).transfer(&me, &order.buyer, &order.credits);
    }
    order.status = OrderStatus::Completed;
    save_order(env, &order);
    emit(env, &order);
}

fn emit(env: &Env, order: &Order) {
    OrderUpdated {
        buyer: order.buyer.clone(),
        seller: order.seller.clone(),
        order_id: order.id,
        status: order.status,
    }
    .publish(env);
}

fn next_id(env: &Env, key: DataKey) -> u64 {
    let id: u64 = env.storage().instance().get(&key).unwrap_or(0) + 1;
    env.storage().instance().set(&key, &id);
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, INSTANCE_BUMP);
    id
}

fn save_listing(env: &Env, listing: &Listing) {
    let key = DataKey::Listing(listing.id);
    env.storage().persistent().set(&key, listing);
    bump(env, &key);
}

fn save_order(env: &Env, order: &Order) {
    let key = DataKey::Order(order.id);
    env.storage().persistent().set(&key, order);
    bump(env, &key);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, RECORD_BUMP);
}
