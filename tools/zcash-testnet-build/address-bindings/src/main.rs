//! Prove external UFVK ownership and match exact shielded receivers across UA revisions.
//! Uses only public viewing authority and a read-only SQLite connection.
use anyhow::{Context, Result, anyhow, ensure};
use clap::Parser;
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::PathBuf};
use zcash_address::unified::{Address as EncodedUa, Container, Encoding, Receiver};
use zcash_keys::{
    address::{Address, UnifiedAddress},
    keys::{ReceiverRequirement, UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedIncomingViewingKey},
};
use zcash_protocol::consensus::{NetworkType, TEST_NETWORK};

#[derive(Parser)]
struct Options {
    #[arg(long)] wallet: PathBuf,
    #[arg(long)] address: String,
}

fn owned_destination(uivk: &UnifiedIncomingViewingKey, encoded: &str) -> Result<UnifiedAddress> {
    let (network, _, raw) = EncodedUa::decode(encoded).map_err(|_| anyhow!("Invalid unified address"))?;
    ensure!(network == NetworkType::Test, "Destination is not testnet");
    ensure!(raw.items().iter().all(|r| !matches!(r, Receiver::Unknown { .. })),
            "Unknown receiver types are unsupported");
    let Some(Address::Unified(target)) = Address::decode(&TEST_NETWORK, encoded) else {
        return Err(anyhow!("Expected a testnet unified address"));
    };
    ensure!(target.orchard().is_some() || target.sapling().is_some(), "No shielded receiver");
    let requirement = |present| if present { ReceiverRequirement::Require } else { ReceiverRequirement::Omit };
    let request = UnifiedAddressRequest::custom(requirement(target.orchard().is_some()),
        requirement(target.sapling().is_some()), requirement(target.transparent().is_some()))
        .map_err(|_| anyhow!("Unsupported receiver requirements"))?;
    for index in uivk.decrypt_diversifiers(&target) {
        if let Ok(derived) = uivk.address(index, request) {
            if derived.orchard() == target.orchard() && derived.sapling() == target.sapling()
                && derived.transparent() == target.transparent() {
                return Ok(*target);
            }
        }
    }
    Err(anyhow!("Destination receivers are not owned by this external viewing key"))
}

fn matching_pools(target: &UnifiedAddress, stored: &Address) -> Vec<&'static str> {
    let mut pools = Vec::new();
    match stored {
        Address::Unified(ua) => {
            if target.orchard().is_some() && target.orchard() == ua.orchard() {
                // Ironwood uses the same receiver as Orchard; it is a distinct output pool.
                pools.extend(["orchard", "ironwood"]);
            }
            if target.sapling().is_some() && target.sapling() == ua.sapling() { pools.push("sapling"); }
        }
        Address::Sapling(receiver) if target.sapling() == Some(receiver) => pools.push("sapling"),
        _ => {}
    }
    pools
}

fn main() -> Result<()> {
    let options = Options::parse();
    let config: toml::Value = std::fs::read_to_string(options.wallet.join("keys.toml"))?.parse()?;
    ensure!(config.get("network").and_then(toml::Value::as_str) == Some("test"), "Wallet is not testnet");
    ensure!(config.get("mnemonic").is_none(), "Wallet contains a mnemonic");
    let db = Connection::open_with_flags(options.wallet.join("data.sqlite"), OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.execute_batch("BEGIN")?;
    let accounts = db.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get::<_, i64>(0))?;
    ensure!(accounts == 1, "Expected one dedicated account");
    let (id, uuid, ufvk, kind, fingerprint, hd_index): (i64, Vec<u8>, String, i64, Option<Vec<u8>>, Option<i64>) =
        db.query_row("SELECT id,uuid,ufvk,account_kind,hd_seed_fingerprint,hd_account_index FROM accounts", [],
            |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?;
    ensure!(kind == 1 && fingerprint.is_none() && hd_index.is_none(), "Account is not viewing-only");
    let ufvk = UnifiedFullViewingKey::decode(&TEST_NETWORK, &ufvk).map_err(|_| anyhow!("Invalid stored viewing key"))?;
    let target = owned_destination(&ufvk.to_unified_incoming_viewing_key(), &options.address)?;
    let mut stmt = db.prepare("SELECT DISTINCT address FROM addresses WHERE account_id=? AND key_scope=0 AND (receiver_flags & 12) != 0")?;
    let addresses = stmt.query_map([id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>,_>>()?;
    let mut unique = BTreeSet::new();
    let mut receivers: Vec<Value> = Vec::new();
    for address in addresses {
        let stored = Address::decode(&TEST_NETWORK, &address).context("Invalid stored testnet address")?;
        for pool in matching_pools(&target, &stored) {
            if unique.insert((address.clone(), pool)) { receivers.push(json!({"address":address,"pool":pool})); }
        }
    }
    println!("{}", json!({"bindingVersion":1,"network":"test","accountUuid":uuid::Uuid::from_slice(&uuid)?.to_string(),
        "destination":options.address,"canonicalDestination":target.encode_receiver_preserving(&TEST_NETWORK),"receivers":receivers}));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_keys::keys::UnifiedSpendingKey;
    use zcash_protocol::consensus::MAIN_NETWORK;
    fn key(seed: u8) -> UnifiedIncomingViewingKey {
        UnifiedSpendingKey::from_seed(&TEST_NETWORK, &[seed;32], zip32::AccountId::ZERO).unwrap()
            .to_unified_full_viewing_key().to_unified_incoming_viewing_key()
    }
    #[test]
    fn accepts_owned_receiver_and_rejects_other_key_and_network() {
        let k = key(7); let (ua, _) = k.default_address(UnifiedAddressRequest::ORCHARD).unwrap();
        assert!(owned_destination(&k, &ua.encode_receiver_preserving(&TEST_NETWORK)).is_ok());
        assert!(owned_destination(&key(8), &ua.encode_receiver_preserving(&TEST_NETWORK)).is_err());
        assert!(owned_destination(&k, &ua.encode_receiver_preserving(&MAIN_NETWORK)).is_err());
    }
    #[test]
    fn wrong_diversifier_never_becomes_an_equivalent_receiver() {
        let k=key(7);
        let a=k.address(zip32::DiversifierIndex::from(0u32), UnifiedAddressRequest::ORCHARD).unwrap();
        let b=k.address(zip32::DiversifierIndex::from(1u32), UnifiedAddressRequest::ORCHARD).unwrap();
        assert!(matching_pools(&a,&Address::Unified(Box::new(b))).is_empty());
    }
    #[test]
    fn orchard_binding_never_authorizes_a_sapling_output() {
        let k=key(7); let (all,_)=k.default_address(UnifiedAddressRequest::AllAvailableKeys).unwrap();
        let orchard=UnifiedAddress::from_receivers(all.orchard().cloned(),None,None,None,None).unwrap();
        assert_eq!(matching_pools(&orchard,&Address::Unified(Box::new(all))),vec!["orchard","ironwood"]);
    }
    #[test]
    fn internal_receiver_does_not_belong_to_external_viewing_key() {
        let full=UnifiedSpendingKey::from_seed(&TEST_NETWORK,&[7u8;32],zip32::AccountId::ZERO).unwrap()
            .to_unified_full_viewing_key();
        let internal=full.orchard().unwrap().to_ivk(zip32::Scope::Internal).address_at(0u32);
        let ua=UnifiedAddress::from_receivers(Some(internal),None,None,None,None).unwrap();
        assert!(owned_destination(&full.to_unified_incoming_viewing_key(),&ua.encode_receiver_preserving(&TEST_NETWORK)).is_err());
    }
    #[test]
    fn legacy_encoding_binds_only_to_the_same_exact_receiver() {
        use zcash_address::unified::Uitem;
        use zcash_protocol::address::Revision;
        let k=key(7); let (ua,_)=k.default_address(UnifiedAddressRequest::ORCHARD).unwrap();
        let (_,_,r2)=EncodedUa::decode(&ua.encode_receiver_preserving(&TEST_NETWORK)).unwrap();
        let r0=EncodedUa::try_from_items(Revision::R0,r2.items().into_iter().map(Uitem::Data).collect()).unwrap();
        let legacy=r0.encode(&NetworkType::Test);
        assert!(legacy.starts_with("utest1"));
        let target=owned_destination(&k,&legacy).unwrap();
        assert_eq!(target.orchard(),ua.orchard());
        assert_eq!(matching_pools(&target,&Address::Unified(Box::new(ua))),vec!["orchard","ironwood"]);
    }
    #[test]
    fn foreign_receiver_cannot_hide_behind_an_owned_receiver() {
        let k=key(7); let (owned,_)=k.default_address(UnifiedAddressRequest::AllAvailableKeys).unwrap();
        let (foreign,_)=key(8).default_address(UnifiedAddressRequest::ORCHARD).unwrap();
        let mixed=UnifiedAddress::from_receivers(foreign.orchard().cloned(),owned.sapling().cloned(),None,None,None).unwrap();
        assert!(owned_destination(&k,&mixed.encode_receiver_preserving(&TEST_NETWORK)).is_err());
    }
}
