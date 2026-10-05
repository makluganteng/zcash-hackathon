//! Narrow testnet wallet surface, reusing official zcash-devtool wallet modules.
use clap::{Parser, Subcommand};
use iso_currency::Currency;
use std::io;
mod commands;
mod config;
mod data;
mod error;
mod remote;
mod socks;
mod ui;

pub(crate) type WalletRng = rand_core::UnwrapErr<rand::rngs::SysRng>;
pub(crate) fn wallet_rng() -> WalletRng { rand_core::UnwrapErr(rand::rngs::SysRng) }
fn parse_hex(value: &str) -> Result<Vec<u8>, hex::FromHexError> { hex::decode(value) }
fn parse_currency(value: &str) -> Result<Currency, String> {
    Currency::from_code(value).ok_or_else(|| format!("Invalid currency '{value}'"))
}
#[derive(Debug, Parser)]
#[command(name = "sealed-zcash-testnet", version = "0.1.0-nu7")]
struct Options { #[command(subcommand)] command: Command }
#[derive(Debug, Subcommand)]
enum Command { Wallet(commands::Wallet) }
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let options = Options::parse();
    tracing_subscriber::fmt().with_writer(io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let Command::Wallet(commands::Wallet { wallet_dir, command }) = options.command;
    use commands::wallet::Command as W;
    match command {
        W::Init(c) => c.run(wallet_dir).await,
        W::InitFvk(c) => c.run(wallet_dir).await,
        W::RestoreMnemonic(c) => c.run(wallet_dir).await,
        W::GetInfo(c) => c.run(wallet_dir).await,
        W::Sync(c) => c.run(ShutdownListener::new(), wallet_dir).await,
        W::Enhance(c) => c.run(wallet_dir).await,
        W::Balance(c) => c.run(wallet_dir).await,
        W::ListAccounts(c) => c.run(wallet_dir),
        W::ListAddresses(c) => c.run(wallet_dir),
        W::ListTx(c) => c.run(wallet_dir),
        W::Send(c) => c.run(wallet_dir).await,
    }
}
struct ShutdownListener { signal_rx: tokio::sync::oneshot::Receiver<()> }
impl ShutdownListener {
    fn new() -> Self {
        let (signal_tx, signal_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move { let _ = tokio::signal::ctrl_c().await; let _ = signal_tx.send(()); });
        Self { signal_rx }
    }
    fn requested(&mut self) -> bool {
        !matches!(self.signal_rx.try_recv(), Err(tokio::sync::oneshot::error::TryRecvError::Empty))
    }
}
#[cfg(test)]
mod protocol_tests {
    use zcash_protocol::consensus::{BranchId, NetworkUpgrade, Parameters, TEST_NETWORK};
    #[test]
    fn nu7_public_testnet_consensus_is_supported() {
        assert_eq!(BranchId::try_from(0x7719_0ad9), Ok(BranchId::Nu7));
        assert_eq!(u32::from(TEST_NETWORK.activation_height(NetworkUpgrade::Nu7).unwrap()), 4_465_026);
        assert_eq!(BranchId::for_height(&TEST_NETWORK, 4_465_026.into()), BranchId::Nu7);
    }
}
