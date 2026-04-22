require('dotenv').config();

const BASE_URL = process.env.SERVER_URL || 'http://localhost:8000';
const ACP_API_BASE_URL = process.env.ACP_API_BASE_URL || `${BASE_URL}/agentic_commerce`;
const API_VERSION = '2026-04-17';
const AGENT_ID = `acp-agent-${Math.random().toString(36).slice(2, 10)}`;

const jsonFetch = async (url, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    'API-Version': API_VERSION,
    ...(options.headers || {})
  };
  if (options.method && options.method !== 'GET') {
    headers['Idempotency-Key'] = `${AGENT_ID}-${Date.now()}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
};

async function runAcpAgent() {
  console.log(`\n[${AGENT_ID}] Starting ACP checkout against ${ACP_API_BASE_URL}.\n`);

  try {
    const checkout = await jsonFetch(`${ACP_API_BASE_URL}/checkout_sessions`, {
      method: 'POST',
      body: JSON.stringify({
        items: [{ id: 'premium_data_access', quantity: 1 }],
        buyer: {
          first_name: 'Demo',
          last_name: 'Agent',
          email: 'agent@example.com'
        },
        capabilities: {
          interventions: {
            supported: ['biometric'],
            display_context: 'native',
            redirect_context: 'none',
            max_redirects: 0,
            max_interaction_depth: 1
          }
        }
      })
    });

    console.log(`[agent] Created checkout session: ${checkout.id}`);
    console.log(`[agent] Status: ${checkout.status}`);

    const approved = await jsonFetch(`${BASE_URL}/api/demo/approve/${checkout.id}`, { method: 'POST' });
    console.log(`[agent] Local approval status: ${approved.checkout_session.status}`);

    const refreshed = await jsonFetch(`${ACP_API_BASE_URL}/checkout_sessions/${checkout.id}`, { method: 'GET' });

    const x402Handler = refreshed.capabilities.payment.handlers.find((handler) => handler.id === 'bankofai_x402_tron_usdt');
    const tronHandler = refreshed.capabilities.payment.handlers.find((handler) => handler.id === 'tron_nile_trc20_usdt');
    if (!x402Handler || !tronHandler) throw new Error('Expected x402 and TRON ACP payment handlers.');
    console.log('[agent] x402 payment instruction:');
    console.log(JSON.stringify(x402Handler.config, null, 2));

    if (!process.env.ACP_TX_HASH) {
      console.log('\n[agent] Run ACP_CHECKOUT_SESSION_ID=%s npm run agent:x402 to complete this checkout with x402.', checkout.id);
      console.log('[agent] Or set ACP_TX_HASH to a matching TRON Nile TRC20 USDT transfer hash to use the fallback receipt endpoint.');
      return;
    }

    const completed = await jsonFetch(`${ACP_API_BASE_URL}/checkout_sessions/${checkout.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        payment_data: {
          handler_id: tronHandler.id,
          instrument: {
            type: 'blockchain_receipt',
            credential: {
              type: 'tron_tx_hash',
              token: process.env.ACP_TX_HASH
            }
          }
        }
      })
    });

    console.log(`[agent] Completed checkout: ${completed.id}`);
    console.log(JSON.stringify(completed.order, null, 2));
  } catch (error) {
    console.error('[agent] Execution error:', error.message || error);
    process.exitCode = 1;
  }
}

runAcpAgent();
