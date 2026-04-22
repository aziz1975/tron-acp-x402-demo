require('dotenv').config();

const MERCHANT_BASE_URL = process.env.SERVER_URL || 'http://localhost:8000';
const RESOURCE_PATH = '/api/premium-data';
const AGENT_ID = `x402-agent-${Math.random().toString(36).slice(2, 10)}`;

async function runX402Agent() {
  console.log(`\n[${AGENT_ID}] Starting x402-capable TRON agent.\n`);

  try {
    const {
      X402Client,
      X402FetchClient,
      ExactPermitTronClientMechanism,
      ExactGasFreeClientMechanism,
      TronClientSigner,
      SufficientBalancePolicy,
      GasFreeAPIClient,
      getGasFreeApiBaseUrl,
      findByAddress,
      decodePaymentPayload
    } = await import('@bankofai/x402');

    if (!process.env.TRON_PRIVATE_KEY) {
      throw new Error('TRON_PRIVATE_KEY is required for the x402 demo agent.');
    }

    const tronSigner = await TronClientSigner.create();
    const x402Client = new X402Client();
    const gasfreeClients = {
      'tron:nile': new GasFreeAPIClient(process.env.GASFREE_API_BASE_URL_NILE || getGasFreeApiBaseUrl('tron:nile')),
      'tron:shasta': new GasFreeAPIClient(process.env.GASFREE_API_BASE_URL_SHASTA || getGasFreeApiBaseUrl('tron:shasta')),
      'tron:mainnet': new GasFreeAPIClient(process.env.GASFREE_API_BASE_URL_MAINNET || getGasFreeApiBaseUrl('tron:mainnet'))
    };

    x402Client.register('tron:*', new ExactPermitTronClientMechanism(tronSigner));
    x402Client.register('tron:*', new ExactGasFreeClientMechanism(tronSigner, gasfreeClients));
    x402Client.registerPolicy(SufficientBalancePolicy);
    x402Client.registerPolicy({
      apply(requirements) {
        const gasFreeUsdt = requirements.find((requirement) => {
          const tokenInfo = findByAddress(requirement.network, requirement.asset);
          return requirement.scheme === 'exact_gasfree' && tokenInfo && tokenInfo.symbol === 'USDT';
        });
        return gasFreeUsdt ? [gasFreeUsdt] : requirements;
      }
    });

    const client = new X402FetchClient(x402Client);
    const resourceUrl = new URL(RESOURCE_PATH, MERCHANT_BASE_URL);
    if (process.env.ACP_CHECKOUT_SESSION_ID) {
      resourceUrl.searchParams.set('checkout_session_id', process.env.ACP_CHECKOUT_SESSION_ID);
    }

    console.log(`[agent] Wallet address: ${tronSigner.getAddress()}`);
    console.log(`[agent] GET ${resourceUrl.toString()}`);

    const response = await client.get(resourceUrl.toString());
    const paymentResponseHeader = response.headers.get('payment-response');
    console.log(`[agent] Resource response: HTTP ${response.status} ${response.statusText}`);

    if (paymentResponseHeader) {
      const settlement = decodePaymentPayload(paymentResponseHeader);
      console.log('[agent] x402 settlement completed.');
      console.log(`        Network: ${settlement.network}`);
      console.log(`        TX Hash: ${settlement.transaction}`);
    }

    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));

    console.log('[agent] Premium payload:');
    console.log(JSON.stringify(body.data, null, 2));
  } catch (error) {
    console.error('[agent] Execution error:', error.message || error);
    process.exitCode = 1;
  }
}

runX402Agent();
