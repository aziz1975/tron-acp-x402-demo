import hashlib
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from tronpy import AsyncTron
from tronpy.providers.async_http import AsyncHTTPProvider

from bankofai.x402.facilitator import FacilitatorClient
from bankofai.x402.fastapi import X402Middleware
from bankofai.x402.mechanisms.tron.exact_gasfree.server import ExactGasFreeServerMechanism
from bankofai.x402.server import X402Server
from bankofai.x402.utils import tron_client

load_dotenv()

NETWORK = os.environ.get("X402_NETWORK", "tron:nile")
PAY_TO_ADDRESS = os.environ["MERCHANT_ADDRESS"]
FACILITATOR_URL = os.environ.get("FACILITATOR_URL", "https://facilitator.bankofai.io")
TRON_FULL_NODE = os.environ.get("TRON_FULL_NODE")
TRON_GRID_API_KEY = os.environ.get("TRON_GRID_API_KEY")
PRICE_DECIMAL = os.environ.get("X402_PRICE_DECIMAL", "15.00")
PRICE_CURRENCY = os.environ.get("X402_PRICE_CURRENCY", "USDT")
SCHEMES = [
    scheme.strip()
    for scheme in os.environ.get("X402_SERVICE_SCHEMES", "exact_permit").split(",")
    if scheme.strip()
]

logger = logging.getLogger("x402_service")


def create_configured_async_tron_client(network: str):
    """Force x402 transaction verification to use the repo-configured TRON RPC."""
    normalized_network = network.removeprefix("tron:")
    if not TRON_FULL_NODE:
        return tron_client._original_create_async_tron_client(network)

    provider_kwargs = {"endpoint_uri": TRON_FULL_NODE}
    if TRON_GRID_API_KEY:
        provider_kwargs["api_key"] = TRON_GRID_API_KEY

    logger.info(
        "Creating AsyncTron verifier client for network=%s using %s",
        normalized_network,
        TRON_FULL_NODE,
    )
    return AsyncTron(
        provider=AsyncHTTPProvider(**provider_kwargs),
        network=normalized_network,
    )


if not hasattr(tron_client, "_original_create_async_tron_client"):
    tron_client._original_create_async_tron_client = tron_client.create_async_tron_client
tron_client.create_async_tron_client = create_configured_async_tron_client

app = FastAPI(title="TRON ACP x402 Middleware Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

x402_server = (
    X402Server()
    .register(NETWORK, ExactGasFreeServerMechanism())
    .set_facilitator(FacilitatorClient(FACILITATOR_URL))
)
x402 = X402Middleware(x402_server)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "network": NETWORK,
        "facilitator": FACILITATOR_URL,
        "price": f"{PRICE_DECIMAL} {PRICE_CURRENCY}",
        "payTo": PAY_TO_ADDRESS,
        "tronFullNode": TRON_FULL_NODE,
        "schemes": SCHEMES,
    }


@app.get("/premium-data")
@x402.protect(
    prices=[f"{PRICE_DECIMAL} {PRICE_CURRENCY}"],
    schemes=SCHEMES,
    network=NETWORK,
    pay_to=PAY_TO_ADDRESS,
)
async def premium_data(request: Request):
    prompt_source = request.query_params.get("q", "agentic-commerce")
    digest = hashlib.sha256(prompt_source.encode("utf-8")).hexdigest()
    return {
        "success": True,
        "data": {
            "merchant_signal": "TRON ACP merchant exposes x402-paid premium inventory intelligence.",
            "inventory_hint": "premium_data_access has high agent demand",
            "recommended_action": "Offer ACP checkout first, x402 API access for autonomous follow-up calls.",
            "request_fingerprint": digest,
        },
        "payment_protocol": "bankofai_x402",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "x402_service:app",
        host="0.0.0.0",
        port=int(os.environ.get("X402_SERVICE_PORT", "8001")),
    )
