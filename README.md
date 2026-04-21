# TRON ACP x402 Demo

Local demo for two agent-commerce flows on TRON Nile:

- ACP checkout sessions under `/agentic_commerce`, using a demo TRON Nile TRC20 USDT payment handler.
- Bank of AI x402 for `GET /api/premium-data`, proxied through the Express server.

ACP reference: `2026-04-17` public spec snapshot from `agentic-commerce-protocol/agentic-commerce-protocol`.

## What Runs Here

This project starts three local processes:

1. `x402_service.py`
   FastAPI service that generates the x402 `402 Payment Required` challenge for the premium resource.
2. `server.js`
   Express app that serves stable ACP checkout session APIs, order storage, TRON receipt verification, and the x402 proxy route.
3. `frontend`
   Vite dashboard for viewing ACP checkout sessions, x402 payments, and triggering a live x402 demo agent.

Important behavior:

- ACP checkout is exposed at `/agentic_commerce/checkout_sessions`.
- This project intentionally does not expose `/.well-known/acp.json` because that endpoint belongs to an unreleased ACP discovery proposal, not the stable `2026-04-17` OpenAPI surface.
- ACP payment uses an explicit demo handler named `dev.tron.acp.trc20_usdt`.
- x402 remains separate and protects `/api/premium-data`.
- Telegram approval is optional; without Telegram, the server prints and exposes local mock approval URLs.

## Requirements

- Node.js 22+
- npm 10+
- Python 3.10+
- A TRON Nile merchant address for `MERCHANT_ADDRESS`
- A TRON Nile test wallet private key for `TRON_PRIVATE_KEY`
- Nile test TRX and TRC20 USDT for paid agent flows

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
FACILITATOR_URL=https://facilitator.bankofai.io
X402_SERVICE_URL=http://localhost:8001
```

## Run Locally

Terminal 1:

```bash
./.venv-x402/bin/python x402_service.py
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

Complete with a real TRON Nile TRC20 USDT transaction hash:

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

To complete the ACP session, first broadcast an exact TRC20 USDT transfer matching the handler config, then run:

```bash
ACP_TX_HASH=<tx_hash> npm run agent:acp
```

Check the configured agent wallet:

```bash
npm run check:balance
```
