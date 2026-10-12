//! Test-USDC faucet for public test deployments.
//!
//! It must be the admin of the test USDC Stellar Asset Contract. Each account
//! can claim `amount` once every `cooldown` seconds. Never deployed on mainnet,
//! where Escomblock uses Circle USDC.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    token::StellarAssetClient, Address, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    TooSoon = 1,
}

#[contracttype]
enum DataKey {
    Token,
    Amount,
    Cooldown,
    Last(Address),
}

const DAY_LEDGERS: u32 = 17_280;

#[contract]
pub struct Faucet;

#[contractimpl]
impl Faucet {
    pub fn __constructor(env: Env, token: Address, amount: i128, cooldown: u64) {
        let s = env.storage().instance();
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Amount, &amount);
        s.set(&DataKey::Cooldown, &cooldown);
    }

    /// Mints `amount` test USDC to `to`. Returns the amount.
    pub fn claim(env: Env, to: Address) -> i128 {
        to.require_auth();
        let s = env.storage().instance();
        let token: Address = s.get(&DataKey::Token).unwrap();
        let amount: i128 = s.get(&DataKey::Amount).unwrap();
        let cooldown: u64 = s.get(&DataKey::Cooldown).unwrap();

        let now = env.ledger().timestamp();
        let key = DataKey::Last(to.clone());
        if let Some(last) = env.storage().temporary().get::<_, u64>(&key) {
            if now < last + cooldown {
                panic_with_error!(&env, Error::TooSoon);
            }
        }
        env.storage().temporary().set(&key, &now);
        env.storage()
            .temporary()
            .extend_ttl(&key, DAY_LEDGERS, DAY_LEDGERS);
        env.storage()
            .instance()
            .extend_ttl(30 * DAY_LEDGERS, 180 * DAY_LEDGERS);

        StellarAssetClient::new(&env, &token).mint(&to, &amount);
        amount
    }

    pub fn amount(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Amount).unwrap()
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::TokenClient,
    };

    #[test]
    fn claim_respects_cooldown() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let faucet = env.register(Faucet, (sac.address(), 100i128, 3_600u64));
        StellarAssetClient::new(&env, &sac.address()).set_admin(&faucet);
        let client = FaucetClient::new(&env, &faucet);
        let user = Address::generate(&env);

        assert_eq!(client.claim(&user), 100);
        assert_eq!(
            client.try_claim(&user).unwrap_err().unwrap(),
            soroban_sdk::Error::from(Error::TooSoon)
        );
        env.ledger().set_timestamp(1_000 + 3_600);
        client.claim(&user);
        assert_eq!(TokenClient::new(&env, &sac.address()).balance(&user), 200);
    }
}
