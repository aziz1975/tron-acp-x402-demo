const { TronWeb } = require('tronweb');
require('dotenv').config();

const TRON_FULL_NODE = process.env.TRON_FULL_NODE || 'https://nile.trongrid.io';
const TRC20_USDT_CONTRACT = process.env.TRC20_USDT_CONTRACT || 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

const tronWeb = new TronWeb({
  fullNode: TRON_FULL_NODE,
  solidityNode: TRON_FULL_NODE,
  eventServer: TRON_FULL_NODE,
  privateKey: process.env.TRON_PRIVATE_KEY
});

async function check() {
  try {
    if (!process.env.TRON_PRIVATE_KEY) {
      throw new Error('TRON_PRIVATE_KEY is required.');
    }

    const address = tronWeb.defaultAddress.base58;
    console.log('Agent Wallet Address:', address);

    const trx = await tronWeb.trx.getBalance(address);
    console.log('TRX Balance:', trx / 1_000_000);

    const contract = await tronWeb.contract().at(TRC20_USDT_CONTRACT);
    const usdt = await contract.balanceOf(address).call();
    console.log('USDT Balance (Nile TRC20):', Number(usdt.toString()) / 1_000_000);
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  }
}

check();
