require('dotenv').config();

const { TronWeb } = require('tronweb');

const TOKEN_MULTIPLIER = 1_000_000;
const NETWORK = process.env.X402_NETWORK || 'tron:nile';
const TOKEN_ADDRESS = process.env.TRC20_USDT_CONTRACT || 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const REQUIRED_BASE_UNITS = Math.round(Number(process.env.X402_PRICE_DECIMAL || '15.00') * TOKEN_MULTIPLIER);

const formatUnits = (amount) => (Number(amount || 0) / TOKEN_MULTIPLIER).toFixed(6);

async function main() {
  const { TronClientSigner, GasFreeAPIClient, getGasFreeApiBaseUrl } = await import('@bankofai/x402');
  const signer = await TronClientSigner.create();
  const walletAddress = signer.getAddress();
  const apiBaseUrl = process.env.GASFREE_API_BASE_URL_NILE || getGasFreeApiBaseUrl(NETWORK);
  const client = new GasFreeAPIClient(apiBaseUrl);
  const info = await client.getAddressInfo(walletAddress);
  const asset = info.assets.find((entry) => entry.tokenAddress === TOKEN_ADDRESS);
  const transferFee = BigInt(asset && asset.transferFee ? asset.transferFee : 0);
  const activateFee = !info.active ? BigInt(asset && asset.activateFee ? asset.activateFee : 0) : 0n;
  let balanceSource = 'GasFree API';
  let balance = BigInt(asset && asset.balance ? asset.balance : 0);
  if (!asset || asset.balance === undefined || asset.balance === null) {
    const tronWeb = new TronWeb({
      fullNode: process.env.TRON_FULL_NODE || 'https://nile.trongrid.io',
      solidityNode: process.env.TRON_FULL_NODE || 'https://nile.trongrid.io',
      eventServer: process.env.TRON_FULL_NODE || 'https://nile.trongrid.io',
      privateKey: process.env.TRON_PRIVATE_KEY
    });
    const contract = await tronWeb.contract().at(TOKEN_ADDRESS);
    const onChainBalance = await contract.balanceOf(info.gasFreeAddress).call({ from: walletAddress });
    balance = BigInt(onChainBalance.toString());
    balanceSource = 'TRON Nile on-chain';
  }
  const required = BigInt(REQUIRED_BASE_UNITS) + transferFee + activateFee;

  console.log(`Agent wallet: ${walletAddress}`);
  console.log(`GasFree wallet: ${info.gasFreeAddress}`);
  console.log(`GasFree active: ${info.active}`);
  console.log(`GasFree allowSubmit: ${info.allowSubmit}`);
  console.log(`Token: ${TOKEN_ADDRESS}`);
  console.log(`Balance source: ${balanceSource}`);
  console.log(`Balance: ${formatUnits(balance)} USDT`);
  console.log(`Payment amount: ${formatUnits(REQUIRED_BASE_UNITS)} USDT`);
  console.log(`Transfer fee: ${formatUnits(transferFee)} USDT`);
  console.log(`Activation fee: ${formatUnits(activateFee)} USDT`);
  console.log(`Required total: ${formatUnits(required)} USDT`);
  console.log(`Status: ${balance >= required ? 'OK' : 'INSUFFICIENT_BALANCE'}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message || error}`);
  process.exitCode = 1;
});
