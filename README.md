# TRON ACP x402 Demo

Local demo for ACP checkout sessions on TRON Nile, completed through Bank of AI x402 GasFree settlement.

It runs three local services:

- Express API on `http://localhost:8000`
- Python x402 service on `http://localhost:8001`
- Vite dashboard on `http://localhost:5173`

## Requirements

- Node.js 22.12+
- npm 10+
- Python 3.10+
- TRON Nile merchant address for `MERCHANT_ADDRESS`
- TRON Nile test wallet private key for `TRON_PRIVATE_KEY`
- Nile test TRX and TRC20 USDT for the normal agent wallet
- Nile test TRC20 USDT in the derived GasFree wallet

Do not use a production wallet or production private key.

## 1. Install

```bash
git clone https://github.com/aziz1975/tron-acp-x402-demo.git
cd tron-acp-x402-demo

npm install
cd frontend
npm install
cd ..

python3 -m venv .venv-x402
./.venv-x402/bin/pip install -r requirements-x402-service.txt
```

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=8000
SERVER_URL=http://localhost:8000

MERCHANT_ADDRESS=<your_tron_nile_merchant_address>
TRON_PRIVATE_KEY=<your_tron_nile_test_wallet_private_key>
TRC20_USDT_CONTRACT=TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf
TRON_FULL_NODE=https://nile.trongrid.io
TRON_GRID_API_KEY=

FACILITATOR_URL=https://facilitator.bankofai.io
X402_NETWORK=tron:nile
X402_SERVICE_URL=http://localhost:8001
X402_SERVICE_PORT=8001
X402_SERVICE_RESOURCE_PATH=/premium-data
X402_PRICE_DECIMAL=15.00
X402_PRICE_CURRENCY=USDT
X402_SERVICE_SCHEMES=exact_gasfree
```

Optional Telegram approval mode can be enabled with:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Without Telegram, the demo uses local approval buttons in the dashboard.

## 3. Fund Test Wallets

Check the normal agent wallet derived from `TRON_PRIVATE_KEY`:

```bash
npm run check:balance
```

The wallet needs Nile test TRX and Nile test USDT.

Check the derived GasFree wallet:

```bash
npm run check:gasfree
```

If the status is not `OK`, copy the printed `GasFree wallet` address and send it enough Nile USDT for:

```text
15.000000 USDT payment + GasFree transfer fee
```

Run the check again:

```bash
npm run check:gasfree
```

Expected:

```text
Status: OK
```

## 4. Start Services

Terminal 1:

```bash
npm run x402:service
```

Terminal 2:

```bash
npm run server
```

Terminal 3:

```bash
cd frontend
npm run dev
```

## 5. Verify Services

Run these from a separate terminal:

```bash
curl http://localhost:8001/health
curl http://localhost:8000/api/orders
```

The x402 health response should include:

```json
{
  "network": "tron:nile",
  "tronFullNode": "https://nile.trongrid.io",
  "schemes": ["exact_gasfree"]
}
```

Open:

- Dashboard: `http://localhost:5173`
- ACP explorer: `http://localhost:8000/acp-explorer`
- Orders API: `http://localhost:8000/api/orders`

## 6. Run The Dashboard Flow

1. Open `http://localhost:5173`.
2. Click `New ACP Session`.
3. Approve the created session.
4. Click `Pay`.
5. Wait for GasFree settlement.
6. Confirm the row changes to `completed` and shows a transaction hash.

Expected completed state:

```text
status: completed
transfer_state: completed
txHash: <tron_tx_hash>
order.status: confirmed
```

## 7. Run The Same Flow With Curl

Create a checkout session:

```bash
curl -X POST http://localhost:8000/agentic_commerce/checkout_sessions \
  -H 'Content-Type: application/json' \
  -H 'API-Version: 2026-04-17' \
  -H 'Idempotency-Key: demo-create-1' \
  -d '{"items":[{"id":"premium_data_access","quantity":1}]}'
```

Approve it:

```bash
curl -X POST http://localhost:8000/api/demo/approve/<checkout_session_id>
```

Pay through x402:

```bash
curl -X POST http://localhost:8000/api/demo/pay-acp-x402/<checkout_session_id>
```

Fetch the final ACP session:

```bash
curl http://localhost:8000/agentic_commerce/checkout_sessions/<checkout_session_id>
```

The ACP checkout session collection endpoint is POST-only for creation. Use `GET /agentic_commerce/checkout_sessions/<checkout_session_id>` after you have a real session id.

## 8. Optional Agent Commands

Create an ACP session with the demo agent:

```bash
npm run agent:acp
```

Call the x402-protected premium resource:

```bash
npm run agent:x402
```

Complete a specific ACP checkout through x402:

```bash
ACP_CHECKOUT_SESSION_ID=<checkout_session_id> npm run agent:x402
```

## 9. Static Checks

```bash
npm run check
./.venv-x402/bin/python -m py_compile x402_service.py

cd frontend
npm run build
```

## How ACP And x402 Work Here

The dashboard creates an ACP checkout session through:

```text
POST /agentic_commerce/checkout_sessions
```

The server stores the session in `orders.json` with:

```text
status: pending_approval
transfer_state: awaiting_human_approval
payment_protocol: acp_x402_tron_usdt
amount: 15 USDT
```

After approval, the session becomes `ready_for_payment`. The Pay button calls:

```text
POST /api/demo/pay-acp-x402/:id
```

Express then requests the x402-protected resource:

```text
GET /api/premium-data?checkout_session_id=:id
```

That request is proxied to the Python x402 service:

```text
GET http://localhost:8001/premium-data?checkout_session_id=:id
```

The first request returns `402 Payment Required`. Express signs the x402 payload using `TRON_PRIVATE_KEY`, selects the `exact_gasfree` mechanism, and retries the request with `PAYMENT-SIGNATURE`.

When settlement succeeds, GasFree submits a TRON Nile transaction. Express stores the transaction hash and marks the ACP checkout as:

```text
status: completed
transfer_state: completed
order.status: confirmed
```

The fallback ACP TRON receipt handler is still available through:

```text
POST /agentic_commerce/checkout_sessions/:id/complete
```

## Troubleshooting

### Pay returns `insufficient balance in gasfree wallet`

Run:

```bash
npm run check:gasfree
```

Fund the printed `GasFree wallet` address with the `Required total` amount of Nile USDT, then create a new ACP session and try Pay again.

### Health does not show `exact_gasfree`

Check:

```bash
curl http://localhost:8001/health
```

Expected:

```json
{
  "schemes": ["exact_gasfree"],
  "tronFullNode": "https://nile.trongrid.io"
}
```

If the response is wrong, update `.env` and restart `npm run x402:service`.

### Pay returns `Transaction verification failed` with a `txHash`

GasFree submitted the transaction, but the TRON RPC did not verify it immediately. The Express server still completes the ACP checkout and stores `verification_status: "deferred"` in `payment_data`.

## Related Links

- [Agentic Commerce Protocol docs](https://www.agenticcommerce.dev/docs)
- [ACP GitHub repository](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)
- [ACP 2026-04-17 OpenAPI specs](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-04-17/openapi)
- [ACP 2026-04-17 examples](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/examples/2026-04-17)
- [x402 standard site](https://www.x402.org/)
- [x402 Foundation repository](https://github.com/x402-foundation/x402)
- [BofAI x402 SDK repository](https://github.com/BofAI/x402)
- [bankofai-x402 on PyPI](https://pypi.org/project/bankofai-x402/)
- [TRON network docs](https://developers.tron.network/docs/networks)
