# TRON ACP x402 Demo

Local demo for two agent-commerce flows on TRON Nile:

- ACP checkout sessions under `/agentic_commerce`, using x402 GasFree settlement as the primary payment path.
- Bank of AI x402 for `GET /api/premium-data`, proxied through the Express server.

ACP reference: `2026-04-17` public spec snapshot from `agentic-commerce-protocol/agentic-commerce-protocol`.

## What Runs Here

This project starts three local processes:

1. `x402_service.py`
   FastAPI service that generates the x402 `402 Payment Required` challenge for the premium resource. It registers the TRON `exact_gasfree` server mechanism.
2. `server.js`
   Express app that serves stable ACP checkout session APIs, order storage, x402-backed ACP completion, TRON receipt fallback verification, and the x402 proxy route.
3. `frontend`
   Vite dashboard for viewing ACP checkout sessions, x402 payments, and triggering a live x402 demo agent.

Important behavior:

- ACP checkout is exposed at `/agentic_commerce/checkout_sessions`.
- This project intentionally does not expose `/.well-known/acp.json` because that endpoint belongs to an unreleased ACP discovery proposal, not the stable `2026-04-17` OpenAPI surface.
- ACP payment advertises `dev.x402.tron_usdt` first, using x402 `exact_gasfree` settlement to complete the checkout.
- The previous `dev.tron.acp.trc20_usdt` receipt handler remains available as a fallback.
- x402 protects `/api/premium-data`; when called with `checkout_session_id`, a successful settlement completes that ACP checkout.
- Telegram approval is optional; without Telegram, the server prints and exposes local mock approval URLs.

## How The ACP + x402 Flow Works

The dashboard starts with an ACP checkout session and uses x402 as the payment rail that completes that session.

### 1. Click `New ACP Session`

The frontend creates an ACP checkout session:

```http
POST http://localhost:8000/agentic_commerce/checkout_sessions
```

The Express server stores a record in `orders.json` with:

```text
status: pending_approval
transfer_state: awaiting_merchant_approval
payment_protocol: acp_x402_tron_usdt
amount: 15 USDT
```

The ACP session advertises two payment handlers:

- `bankofai_x402_tron_usdt`: primary handler that points to `http://localhost:8000/api/premium-data?checkout_session_id=<session_id>`.
- `tron_nile_trc20_usdt`: fallback handler for completing ACP with a manual TRON transaction hash.

### 2. Approve The Session

The dashboard approval action calls:

```http
POST http://localhost:8000/api/demo/approve/<checkout_session_id>
```

The session becomes:

```text
status: ready_for_payment
transfer_state: ready_for_transfer
```

At this point the dashboard shows the `Pay` button.

### 3. Click `Pay`

The frontend calls:

```http
POST http://localhost:8000/api/demo/pay-acp-x402/<checkout_session_id>
```

The Express server marks the checkout as:

```text
status: complete_in_progress
transfer_state: x402_payment_in_progress
```

Then Express starts the x402 payment flow.

### 4. x402 Challenge

Express requests the x402-protected resource through its proxy:

```http
GET http://localhost:8000/api/premium-data?checkout_session_id=<checkout_session_id>
```

That request is proxied to the Python x402 service:

```http
GET http://localhost:8001/premium-data?checkout_session_id=<checkout_session_id>
```

Because the first request has no `PAYMENT-SIGNATURE`, the Python service returns:

```http
402 Payment Required
```

The x402 challenge includes:

```text
scheme: exact_gasfree
network: tron:nile
amount: 15000000
asset: TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf
payTo: MERCHANT_ADDRESS
```

### 5. Sign And Settle x402

Express uses `@bankofai/x402` and `TRON_PRIVATE_KEY` to select `exact_gasfree`, derive the GasFree wallet, check its USDT balance, and sign a GasFree payment permit.

Express retries the protected resource request with:

```http
PAYMENT-SIGNATURE: <signed_x402_payload>
```

The Python x402 middleware verifies the payload and settles through Bank of AI x402 / GasFree. GasFree submits a real TRON Nile transaction.

### 6. Complete ACP

When settlement returns a TRON transaction hash, Express updates the ACP checkout session:

```text
status: completed
transfer_state: completed
txHash: <tron_tx_hash>
order.status: confirmed
```

The dashboard refreshes, the checkout shows `completed`, and the `Pay` button disappears.

If GasFree returns a tx hash but the TRON verifier RPC fails temporarily, Express still completes the ACP session and stores `verification_status: "deferred"` in `payment_data`.

The important endpoints in the combined flow are:

```text
POST /agentic_commerce/checkout_sessions
POST /api/demo/approve/:id
POST /api/demo/pay-acp-x402/:id
GET  /api/premium-data?checkout_session_id=:id
GET  http://localhost:8001/premium-data?checkout_session_id=:id
GET  /agentic_commerce/checkout_sessions/:id
```

## Requirements

- Node.js 22+
- npm 10+
- Python 3.10+
- A TRON Nile merchant address for `MERCHANT_ADDRESS`
- A TRON Nile test wallet private key for `TRON_PRIVATE_KEY`
- Nile test TRX and TRC20 USDT for the normal agent wallet
- Nile test TRC20 USDT in the derived GasFree wallet for the x402 GasFree payment path

## Fresh Local Setup And Test

Use this path when setting up the repo from scratch.

### 1. Clone And Install

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

### 2. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and set:

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

`TRON_PRIVATE_KEY` is the agent wallet key. Do not use a production wallet.

### 3. Fund The Test Wallets

Fund the normal agent wallet with Nile test TRX and Nile test USDT:

```bash
npm run check:balance
```

Then find and fund the derived GasFree wallet:

```bash
npm run check:gasfree
```

Copy the printed `GasFree wallet` address and send it enough Nile USDT for:

```text
15.000000 USDT payment + GasFree transfer fee
```

Run `npm run check:gasfree` again. It must print:

```text
Status: OK
```

### 4. Start The Services

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

### 5. Verify Services

```bash
curl http://localhost:8001/health
curl http://localhost:8000/agentic_commerce/checkout_sessions
```

The x402 health response should include:

```json
{
  "network": "tron:nile",
  "tronFullNode": "https://nile.trongrid.io",
  "schemes": ["exact_gasfree"]
}
```

### 6. Test In The Dashboard

Open:

```text
http://localhost:5173
```

Then:

1. Click `New ACP Session`.
2. Approve the created session.
3. Click `Pay`.
4. Wait for GasFree settlement.
5. Confirm the row changes to `completed` and shows a transaction hash.

The completed session should have:

```text
status: completed
transfer_state: completed
txHash: <tron_tx_hash>
order.status: confirmed
```

### 7. Test With Curl Instead Of The UI

Create a session:

```bash
curl -X POST http://localhost:8000/agentic_commerce/checkout_sessions \
  -H 'Content-Type: application/json' \
  -H 'API-Version: 2026-04-17' \
  -H 'Idempotency-Key: fresh-demo-create-1' \
  -d '{"items":[{"id":"premium_data_access","quantity":1}]}'
```

Approve it:

```bash
curl -X POST http://localhost:8000/api/demo/approve/<checkout_session_id>
```

Pay it through the same endpoint used by the dashboard:

```bash
curl -X POST http://localhost:8000/api/demo/pay-acp-x402/<checkout_session_id>
```

Fetch the final ACP session:

```bash
curl http://localhost:8000/agentic_commerce/checkout_sessions/<checkout_session_id>
```

Expected final state:

```text
status: completed
transfer_state: completed
txHash: <tron_tx_hash>
```

### 8. Run Static Checks

```bash
npm run check
./.venv-x402/bin/python -m py_compile x402_service.py
```

## Install

```bash
npm install
cd frontend
npm install
cd ..

python3 -m venv .venv-x402
./.venv-x402/bin/pip install -r requirements-x402-service.txt
```

## Configure

```bash
cp .env.example .env
```

Set at least:

```env
PORT=8000
MERCHANT_ADDRESS=TYourMerchantWalletAddress
TRON_PRIVATE_KEY=your_nile_test_agent_private_key
TRC20_USDT_CONTRACT=TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf
TRON_FULL_NODE=https://nile.trongrid.io
# Optional but recommended for reliable TronGrid requests.
TRON_GRID_API_KEY=
FACILITATOR_URL=https://facilitator.bankofai.io
X402_SERVICE_URL=http://localhost:8001
X402_NETWORK=tron:nile
X402_PRICE_DECIMAL=15.00
X402_PRICE_CURRENCY=USDT
X402_SERVICE_SCHEMES=exact_gasfree
```

`X402_PRICE_DECIMAL` must match the ACP product price. The default `premium_data_access` product costs `15.00 USDT`.

`TRON_FULL_NODE` is used by both the Express server and the Python x402 middleware transaction verifier. Keep it set to `https://nile.trongrid.io` for Nile unless you intentionally use another Nile RPC. The x402 middleware health endpoint prints the active verifier RPC as `tronFullNode`.

Before clicking Pay, check both wallet layers:

```bash
npm run check:balance
npm run check:gasfree
```

`check:balance` checks the normal agent wallet derived from `TRON_PRIVATE_KEY`.

`check:gasfree` asks the GasFree API for the derived GasFree wallet, prints its address, and verifies it has enough Nile USDT for:

```text
payment amount + GasFree transfer fee
```

If it prints `INSUFFICIENT_BALANCE`, fund the printed `GasFree wallet` address before testing the Pay button.

## Run Locally

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

Open:

- Dashboard: `http://localhost:5173`
- ACP explorer: `http://localhost:8000/acp-explorer`
- ACP checkout API: `http://localhost:8000/agentic_commerce/checkout_sessions`

## ACP Checkout Smoke Test

Create a checkout session:

```bash
curl -X POST http://localhost:8000/agentic_commerce/checkout_sessions \
  -H 'Content-Type: application/json' \
  -H 'API-Version: 2026-04-17' \
  -H 'Idempotency-Key: demo-create-1' \
  -d '{"items":[{"id":"premium_data_access","quantity":1}]}'
```

Approve locally if Telegram is not configured:

```bash
curl -X POST http://localhost:8000/api/demo/approve/<checkout_session_id>
```

Complete through x402:

```bash
ACP_CHECKOUT_SESSION_ID=<checkout_session_id> npm run agent:x402
```

Or complete through the same endpoint used by the dashboard Pay button:

```bash
curl -X POST http://localhost:8000/api/demo/pay-acp-x402/<checkout_session_id>
```

Or complete with the fallback TRON Nile TRC20 USDT transaction hash endpoint:

```bash
curl -X POST http://localhost:8000/agentic_commerce/checkout_sessions/<checkout_session_id>/complete \
  -H 'Content-Type: application/json' \
  -H 'API-Version: 2026-04-17' \
  -H 'Idempotency-Key: demo-complete-1' \
  -d '{"payment_data":{"handler_id":"tron_nile_trc20_usdt","instrument":{"type":"blockchain_receipt","credential":{"type":"tron_tx_hash","token":"<tx_hash>"}}}}'
```

## x402 Smoke Test

Unpaid request directly to the Python service:

```bash
curl -i http://localhost:8001/premium-data
```

Proxied through Express:

```bash
curl -i http://localhost:8000/api/premium-data
```

Run the x402-capable demo agent:

```bash
npm run agent:x402
```

For the ACP-integrated x402 path, include the checkout session id:

```bash
ACP_CHECKOUT_SESSION_ID=<checkout_session_id> npm run agent:x402
```

## Demo Agents

ACP checkout session creation:

```bash
npm run agent:acp
```

The ACP demo agent uses:

```env
ACP_API_BASE_URL=http://localhost:8000/agentic_commerce
```

If this value is not set, it derives the same URL from `SERVER_URL`.

To complete the ACP session through x402, approve the session and run:

```bash
ACP_CHECKOUT_SESSION_ID=<checkout_session_id> npm run agent:x402
```

To complete with the fallback TRON receipt flow, first broadcast an exact TRC20 USDT transfer matching the fallback handler config, then run:

```bash
ACP_TX_HASH=<tx_hash> npm run agent:acp
```

Check the configured agent wallet:

```bash
npm run check:balance
```

For the x402 GasFree payment path, also check the derived GasFree wallet:

```bash
npm run check:gasfree
```

The GasFree wallet must hold enough Nile USDT for the payment amount plus the GasFree transfer fee. If this reports `INSUFFICIENT_BALANCE`, fund the printed `GasFree wallet` address before clicking Pay.

## Troubleshooting

### Pay returns `insufficient balance in gasfree wallet`

Run:

```bash
npm run check:gasfree
```

Fund the printed `GasFree wallet` address with the `Required total` amount of Nile USDT, then create a new ACP session and try Pay again.

If `npm run check:gasfree` reports `Status: OK` but the remote x402 facilitator still returns this error, the Express Pay endpoint performs its own on-chain GasFree balance check and submits the already-signed GasFree payment directly to the GasFree API.

### Pay returns `Settlement failed: transaction_failed`

This means the x402 facilitator failed settlement after the client signed the payment payload. Confirm the service is using GasFree:

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

If it still shows `exact_permit`, restart `npm run x402:service` after updating `.env`.

If `tronFullNode` is missing or wrong, set `TRON_FULL_NODE=https://nile.trongrid.io` in `.env` and restart `npm run x402:service`.

### Pay returns `Transaction verification failed` with a `txHash`

This means GasFree submitted the transaction and returned a TRON transaction hash, but the x402 middleware could not verify it immediately because the configured TRON RPC returned an upstream error, commonly `502 Bad Gateway`.

The Express ACP server treats this as a submitted settlement and completes the checkout using the returned `txHash`. The ACP `payment_data` stores `verification_status: "deferred"` and the original verification error so you can inspect it later.

Confirm the x402 middleware is not using tronpy's default Nile endpoint:

```bash
curl http://localhost:8001/health
```

Expected:

```json
"tronFullNode": "https://nile.trongrid.io"
```

If you still see logs for `https://api.nileex.io/wallet/gettransactioninfobyid`, restart `npm run x402:service` so the middleware loads the repo's `TRON_FULL_NODE` override.

### Pay button appears again or status becomes `failed`

Strict behavior is enabled. ACP only becomes `completed` after a successful x402 settlement. If settlement fails, the session becomes `failed` and the dashboard shows `last_error`.
