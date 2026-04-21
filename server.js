require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const { TronWeb } = require('tronweb');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const {
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_RESPONSE_HEADER,
  getX402Module
} = require('./x402-utils');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 8000);
const ACP_VERSION = '2026-04-17';
const ACP_BASE_PATH = '/agentic_commerce';
const TRON_HANDLER_ID = 'tron_nile_trc20_usdt';
const TRON_HANDLER_VERSION = '2026-04-21';
const TRC20_TRANSFER_SELECTOR = 'a9059cbb';
const TOKEN_DECIMALS = 6;
const TOKEN_MULTIPLIER = 1_000_000;

const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS || 'TQGfKPHs3AwiBT44ibkCU64u1G4ttojUXU';
const TRC20_USDT_CONTRACT = process.env.TRC20_USDT_CONTRACT || 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_FULL_NODE = process.env.TRON_FULL_NODE || 'https://nile.trongrid.io';
const X402_FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.bankofai.io';
const X402_SERVICE_URL = process.env.X402_SERVICE_URL || 'http://localhost:8001';
const X402_SERVICE_RESOURCE_PATH = process.env.X402_SERVICE_RESOURCE_PATH || '/premium-data';

const CATALOG = {
  premium_data_access: {
    id: 'premium_data_access',
    name: 'Premium Agent Data Access',
    description: 'One-time access to a premium commerce intelligence payload for AI agents.',
    unitAmount: 15 * TOKEN_MULTIPLIER,
    currency: 'USDT',
    image: '/public/product-premium-data.svg'
  },
  agent_market_report: {
    id: 'agent_market_report',
    name: 'TRON Agent Market Report',
    description: 'A downloadable market brief for agentic payment experimentation.',
    unitAmount: 25 * TOKEN_MULTIPLIER,
    currency: 'USDT',
    image: '/public/product-market-report.svg'
  }
};

const tronWeb = new TronWeb({
  fullNode: TRON_FULL_NODE,
  solidityNode: TRON_FULL_NODE,
  eventServer: TRON_FULL_NODE
});

const getBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;
const getAcpBaseUrl = (req) => `${getBaseUrl(req)}${ACP_BASE_PATH}`;
const formatBaseUnits = (amount) => (Number(amount) / TOKEN_MULTIPLIER).toFixed(TOKEN_DECIMALS);
const nowIso = () => new Date().toISOString();
const randomSuffix = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const checkoutId = () => `cs_tron_${randomSuffix()}`;
const orderId = (sessionId) => `ord_${sessionId}`;

const sendAcpHeaders = (req, res) => {
  if (req.get('Idempotency-Key')) res.setHeader('Idempotency-Key', req.get('Idempotency-Key'));
  if (req.get('Request-Id')) res.setHeader('Request-Id', req.get('Request-Id'));
};

const acpError = (res, status, code, message) => res.status(status).json({
  type: 'invalid_request',
  code,
  message
});

const requireAcpPostHeaders = (req, res) => {
  if (!req.get('Idempotency-Key')) {
    acpError(res, 400, 'idempotency_key_required', 'Idempotency-Key header is required for ACP POST requests.');
    return false;
  }
  return true;
};

const normalizeRequestedItems = (body) => {
  const requestedItems = body.line_items || body.items || [{ id: 'premium_data_access', quantity: 1 }];
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new Error('At least one line item is required.');
  }

  let total = 0;
  const lineItems = requestedItems.map((entry, index) => {
    const itemId = entry.id || (entry.item && entry.item.id);
    const quantity = Number(entry.quantity || 1);
    const catalogItem = CATALOG[itemId];

    if (!catalogItem) throw new Error(`Unsupported line item: ${itemId || 'unknown'}`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Invalid quantity for ${itemId}.`);

    const lineTotal = catalogItem.unitAmount * quantity;
    total += lineTotal;

    return {
      id: `li_${index + 1}`,
      item: { id: catalogItem.id },
      quantity,
      name: catalogItem.name,
      description: catalogItem.description,
      images: [`${body.image_base_url || ''}${catalogItem.image}`],
      unit_amount: catalogItem.unitAmount,
      custom_attributes: [
        { display_name: 'Network', value: 'TRON Nile' },
        { display_name: 'Asset', value: 'TRC20 USDT' }
      ],
      totals: [
        { type: 'items_base_amount', display_text: 'Base amount', amount: lineTotal },
        { type: 'subtotal', display_text: 'Subtotal', amount: lineTotal },
        { type: 'total', display_text: 'Total', amount: lineTotal }
      ]
    };
  });

  return {
    currency: 'USDT',
    presentment_currency: 'USDT',
    lineItems,
    totalBaseUnits: total,
    totals: [
      { type: 'items_base_amount', display_text: 'Item total', amount: total },
      { type: 'subtotal', display_text: 'Subtotal', amount: total },
      { type: 'tax', display_text: 'Tax', amount: 0 },
      { type: 'total', display_text: 'Total', amount: total }
    ]
  };
};

const buildTronPaymentHandler = (req, session) => ({
  id: TRON_HANDLER_ID,
  name: 'dev.tron.acp.trc20_usdt',
  display_name: 'TRON Nile TRC20 USDT',
  version: TRON_HANDLER_VERSION,
  spec: `${getBaseUrl(req)}/public/tron-nile-acp-handler.json`,
  requires_delegate_payment: false,
  requires_pci_compliance: false,
  psp: 'tron',
  config_schema: `${getBaseUrl(req)}/public/tron-nile-acp-handler.schema.json`,
  instrument_schemas: [`${getBaseUrl(req)}/public/tron-nile-acp-instrument.schema.json`],
  config: {
    network: 'tron:nile',
    chain: 'TRON_NILE',
    asset: 'TRC20_USDT',
    contract_address: TRC20_USDT_CONTRACT,
    receiver_address: MERCHANT_ADDRESS,
    amount: session ? String(session.amount_in_base_units) : undefined,
    amount_decimal: session ? formatBaseUnits(session.amount_in_base_units) : undefined,
    transfer_state: session ? session.transfer_state : 'available'
  },
  display_order: 0
});

const getMessages = (session) => {
  const map = {
    pending_approval: ['human_approval_required', 'info', 'Merchant approval is required before the agent can submit a TRON payment receipt.'],
    ready_for_payment: ['tron_transfer_ready', 'info', 'The agent can broadcast the TRC20 USDT transfer and complete the checkout with the transaction hash.'],
    complete_in_progress: ['verifying_receipt', 'info', 'The submitted TRON transaction is being verified on Nile.'],
    completed: ['checkout_completed', 'info', 'Payment verified and the order has been confirmed.'],
    canceled: ['checkout_canceled', 'fatal', 'The checkout session was canceled.'],
    failed: ['payment_verification_failed', 'recoverable', 'The submitted transaction did not match the checkout requirements.']
  };
  const entry = map[session.status];
  if (!entry) return [];
  return [{ code: entry[0], severity: entry[1], content: entry[2] }];
};

const buildCheckoutLinks = (req, session) => {
  const self = `${getAcpBaseUrl(req)}/checkout_sessions/${session.id}`;
  return {
    self,
    complete: `${self}/complete`,
    cancel: `${self}/cancel`
  };
};

const buildCheckoutSession = (req, session) => {
  const response = {
    id: session.id,
    protocol: { version: ACP_VERSION },
    capabilities: {
      payment: { handlers: [buildTronPaymentHandler(req, session)] },
      interventions: {
        supported: ['biometric'],
        required: session.status === 'pending_approval' ? ['biometric'] : [],
        enforcement: session.status === 'pending_approval' ? 'required' : 'conditional'
      },
      extensions: [
        {
          name: 'tron_payment_handler',
          extends: '$.capabilities.payment.handlers',
          spec: `${getBaseUrl(req)}/public/tron-nile-acp-handler.json`,
          schema: `${getBaseUrl(req)}/public/tron-nile-acp-handler.schema.json`
        }
      ]
    },
    buyer: session.buyer || null,
    status: session.status,
    currency: session.currency,
    presentment_currency: session.presentment_currency,
    locale: session.locale || 'en-US',
    line_items: session.line_items,
    fulfillment_details: session.fulfillment_details || null,
    totals: session.totals,
    messages: getMessages(session),
    payment_data: session.payment_data || null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    links: buildCheckoutLinks(req, session)
  };

  if (session.order) {
    response.order = session.order;
  }

  return response;
};

const normalizeAddress = (address) => {
  if (!address) return null;
  if (/^41[0-9a-fA-F]{40}$/.test(address)) {
    return tronWeb.address.fromHex(address);
  }
  return address;
};

const decodeTrc20TransferData = (data) => {
  if (!data || typeof data !== 'string') return null;
  const normalized = data.replace(/^0x/, '');
  if (!normalized.startsWith(TRC20_TRANSFER_SELECTOR) || normalized.length < 136) return null;

  const encodedRecipient = normalized.slice(8, 72);
  const encodedAmount = normalized.slice(72, 136);
  const recipientHex = `41${encodedRecipient.slice(-40)}`.toLowerCase();

  return {
    recipient: tronWeb.address.fromHex(recipientHex),
    amount: BigInt(`0x${encodedAmount}`).toString()
  };
};

const extractTransactionHash = (body) => {
  if (body.transactionHash) return body.transactionHash;
  if (body.transaction_hash) return body.transaction_hash;
  const paymentData = body.payment_data || {};
  if (paymentData.transaction_hash) return paymentData.transaction_hash;
  const instrument = paymentData.instrument || {};
  const credential = instrument.credential || {};
  if (credential.transaction_hash) return credential.transaction_hash;
  if (credential.token && credential.type === 'tron_tx_hash') return credential.token;
  return null;
};

const verifyTronTransfer = async (transactionHash, session) => {
  let transaction = null;
  let retries = 20;

  while (retries > 0) {
    try {
      transaction = await tronWeb.trx.getTransaction(transactionHash);
      if (transaction && transaction.ret && transaction.ret[0] && transaction.ret[0].contractRet === 'SUCCESS') break;
    } catch (error) {
      // Nile indexing can lag for a few seconds.
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    retries -= 1;
  }

  if (!transaction || !transaction.ret || transaction.ret[0].contractRet !== 'SUCCESS') {
    throw new Error('Transaction is not confirmed as SUCCESS on TRON Nile yet.');
  }

  const contractData = transaction.raw_data.contract[0];
  if (contractData.type !== 'TriggerSmartContract') {
    throw new Error('Transaction is not a TRC20 smart-contract transfer.');
  }

  const parameter = contractData.parameter.value;
  const decodedTransfer = decodeTrc20TransferData(parameter.data);
  if (!decodedTransfer) throw new Error('Transaction data is not a valid TRC20 transfer.');

  const paidTokenContract = normalizeAddress(parameter.contract_address);
  if (paidTokenContract !== TRC20_USDT_CONTRACT) {
    throw new Error('Transaction targets an unexpected token contract.');
  }
  if (decodedTransfer.recipient !== MERCHANT_ADDRESS) {
    throw new Error('Transaction recipient does not match the merchant address.');
  }
  if (decodedTransfer.amount !== String(session.amount_in_base_units)) {
    throw new Error('Transaction amount does not match the checkout amount.');
  }

  return transaction;
};

const sendApprovalPrompt = (session, sourceBaseUrl) => {
  const amount = formatBaseUnits(session.amount_in_base_units);
  const message = [
    'ACP checkout session',
    `Session: ${session.id}`,
    `Amount: ${amount} USDT on TRON Nile`,
    `Order: ${session.merchant_order_id}`
  ].join('\n');

  if (bot && TELEGRAM_CHAT_ID) {
    bot.sendMessage(TELEGRAM_CHAT_ID, message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Approve', callback_data: `approve_${session.id}` }],
          [{ text: 'Reject', callback_data: `reject_${session.id}` }]
        ]
      }
    });
    return;
  }

  console.log('\n[LOCAL ACP APPROVAL]');
  console.log(message);
  console.log(`Approve locally: curl -X POST ${sourceBaseUrl}/api/demo/approve/${session.id}`);
  console.log('');
};

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_MODE_ENABLED = Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID);
let bot = null;

if (TELEGRAM_TOKEN) {
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  bot.on('polling_error', (error) => console.error('[telegram] polling error:', error.message));
  bot.onText(/\/start/, (msg) => {
    console.log(`Telegram chat id: ${msg.chat.id}`);
    bot.sendMessage(msg.chat.id, `Use TELEGRAM_CHAT_ID=${msg.chat.id} in your .env file.`);
  });
  bot.on('callback_query', (query) => {
    const action = query.data || '';
    const message = query.message;
    const approve = action.startsWith('approve_');
    const reject = action.startsWith('reject_');
    if (!approve && !reject) return;

    const id = action.replace(approve ? 'approve_' : 'reject_', '');
    const updated = db.update(id, {
      status: approve ? 'ready_for_payment' : 'canceled',
      transfer_state: approve ? 'ready_for_transfer' : 'rejected',
      humanApprovedAt: approve ? nowIso() : undefined,
      updatedAt: nowIso()
    });
    if (!updated) return;

    bot.editMessageText(`${approve ? 'Approved' : 'Rejected'} ACP checkout session: ${id}`, {
      chat_id: message.chat.id,
      message_id: message.message_id
    });
  });
}

const buildUpstreamX402Url = (req) => {
  const upstreamUrl = new URL(X402_SERVICE_RESOURCE_PATH, X402_SERVICE_URL);
  const queryIndex = req.originalUrl.indexOf('?');
  if (queryIndex !== -1) upstreamUrl.search = req.originalUrl.slice(queryIndex);
  return upstreamUrl.toString();
};

const copyProxyHeaders = (sourceHeaders, targetRes) => {
  const hopByHopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
  sourceHeaders.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) targetRes.setHeader(key, value);
  });
};

const buildX402OrderId = (paymentId) => `x402-${String(paymentId || Date.now()).replace(/^0x/, '')}`;

const recordX402Settlement = async (req, upstreamResponse) => {
  const paymentSignature = req.get(PAYMENT_SIGNATURE_HEADER);
  const paymentResponse = upstreamResponse.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!paymentSignature || !paymentResponse || upstreamResponse.status !== 200) return;

  try {
    const { decodePaymentPayload } = await getX402Module();
    const paymentPayload = decodePaymentPayload(paymentSignature);
    const settlement = decodePaymentPayload(paymentResponse);
    const paymentId = paymentPayload && paymentPayload.payload && paymentPayload.payload.paymentPermit && paymentPayload.payload.paymentPermit.meta && paymentPayload.payload.paymentPermit.meta.paymentId;
    const id = buildX402OrderId(paymentId);
    if (db.findById(id)) return;

    db.create({
      id,
      type: 'x402_payment',
      status: 'completed',
      currency: 'USDT',
      total_amount: Number(formatBaseUnits(paymentPayload.accepted.amount)),
      amount_in_base_units: Number(paymentPayload.accepted.amount),
      txHash: settlement.transaction || null,
      buyer: paymentPayload.payload.paymentPermit.buyer || null,
      payment_protocol: 'bankofai_x402',
      scheme: paymentPayload.accepted.scheme,
      network: paymentPayload.accepted.network,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  } catch (error) {
    console.error('[x402] failed to persist settlement:', error.message);
  }
};

app.get('/acp-explorer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'acp-explorer.html'));
});

app.post(`${ACP_BASE_PATH}/checkout_sessions`, (req, res) => {
  if (!requireAcpPostHeaders(req, res)) return;
  sendAcpHeaders(req, res);

  let normalized;
  try {
    normalized = normalizeRequestedItems({ ...req.body, image_base_url: getBaseUrl(req) });
  } catch (error) {
    return acpError(res, 400, 'invalid_line_items', error.message);
  }

  const createdAt = nowIso();
  const id = checkoutId();
  const session = db.create({
    id,
    type: 'acp_checkout_session',
    merchant_order_id: orderId(id),
    status: 'pending_approval',
    transfer_state: 'awaiting_human_approval',
    buyer: req.body.buyer || null,
    fulfillment_details: req.body.fulfillment_details || null,
    line_items: normalized.lineItems,
    totals: normalized.totals,
    currency: normalized.currency,
    presentment_currency: normalized.presentment_currency,
    total_amount: formatBaseUnits(normalized.totalBaseUnits),
    amount_in_base_units: normalized.totalBaseUnits,
    payment_protocol: 'acp_tron_trc20_usdt',
    txHash: null,
    createdAt,
    updatedAt: createdAt
  });

  sendApprovalPrompt(session, getBaseUrl(req));
  res.status(201).json(buildCheckoutSession(req, session));
});

app.get(`${ACP_BASE_PATH}/checkout_sessions/:id`, (req, res) => {
  const session = db.findById(req.params.id);
  if (!session || session.type !== 'acp_checkout_session') return acpError(res, 404, 'not_found', 'Checkout session not found.');
  res.json(buildCheckoutSession(req, session));
});

app.post(`${ACP_BASE_PATH}/checkout_sessions/:id`, (req, res) => {
  if (!requireAcpPostHeaders(req, res)) return;
  sendAcpHeaders(req, res);

  const session = db.findById(req.params.id);
  if (!session || session.type !== 'acp_checkout_session') return acpError(res, 404, 'not_found', 'Checkout session not found.');
  if (session.status === 'completed') return acpError(res, 409, 'completed_session', 'Completed checkout sessions cannot be updated.');

  let updates = {
    buyer: req.body.buyer !== undefined ? req.body.buyer : session.buyer,
    fulfillment_details: req.body.fulfillment_details !== undefined ? req.body.fulfillment_details : session.fulfillment_details,
    updatedAt: nowIso()
  };

  if (req.body.line_items || req.body.items) {
    try {
      const normalized = normalizeRequestedItems({ ...req.body, image_base_url: getBaseUrl(req) });
      updates = {
        ...updates,
        line_items: normalized.lineItems,
        totals: normalized.totals,
        currency: normalized.currency,
        presentment_currency: normalized.presentment_currency,
        total_amount: formatBaseUnits(normalized.totalBaseUnits),
        amount_in_base_units: normalized.totalBaseUnits,
        status: 'pending_approval',
        transfer_state: 'awaiting_human_approval',
        txHash: null
      };
    } catch (error) {
      return acpError(res, 400, 'invalid_line_items', error.message);
    }
  }

  const updated = db.update(req.params.id, updates);
  if (updates.status === 'pending_approval') sendApprovalPrompt(updated, getBaseUrl(req));
  res.json(buildCheckoutSession(req, updated));
});

app.post(`${ACP_BASE_PATH}/checkout_sessions/:id/complete`, async (req, res) => {
  if (!requireAcpPostHeaders(req, res)) return;
  sendAcpHeaders(req, res);

  const session = db.findById(req.params.id);
  if (!session || session.type !== 'acp_checkout_session') return acpError(res, 404, 'not_found', 'Checkout session not found.');
  if (session.status === 'completed') return res.json(buildCheckoutSession(req, session));
  if (session.status === 'pending_approval') return acpError(res, 409, 'approval_required', 'Checkout session is waiting for merchant approval.');
  if (session.status === 'canceled') return acpError(res, 405, 'not_cancelable', 'Checkout session is canceled.');

  const transactionHash = extractTransactionHash(req.body);
  if (!transactionHash) return acpError(res, 400, 'missing_transaction_hash', 'Submit payment_data.instrument.credential.token with type tron_tx_hash.');

  db.update(session.id, {
    status: 'complete_in_progress',
    transfer_state: 'verifying_blockchain_receipt',
    payment_data: req.body.payment_data || null,
    txHash: transactionHash,
    updatedAt: nowIso()
  });

  try {
    await verifyTronTransfer(transactionHash, session);
    const completedAt = nowIso();
    const completed = db.update(session.id, {
      status: 'completed',
      transfer_state: 'completed',
      txHash: transactionHash,
      updatedAt: completedAt,
      order: {
        type: 'order',
        id: session.merchant_order_id,
        checkout_session_id: session.id,
        order_number: session.merchant_order_id.replace('ord_', '').slice(0, 18),
        permalink_url: `${getBaseUrl(req)}/acp-explorer?session=${session.id}`,
        status: 'confirmed',
        line_items: session.line_items,
        totals: session.totals,
        confirmation: {
          confirmation_number: session.merchant_order_id,
          confirmed_at: completedAt
        }
      }
    });
    return res.json(buildCheckoutSession(req, completed));
  } catch (error) {
    const failed = db.update(session.id, {
      status: 'ready_for_payment',
      transfer_state: 'receipt_rejected',
      last_error: error.message,
      updatedAt: nowIso()
    });
    return res.status(400).json({
      type: 'invalid_request',
      code: 'payment_verification_failed',
      message: error.message,
      checkout_session: buildCheckoutSession(req, failed)
    });
  }
});

app.post(`${ACP_BASE_PATH}/checkout_sessions/:id/cancel`, (req, res) => {
  if (!requireAcpPostHeaders(req, res)) return;
  sendAcpHeaders(req, res);

  const session = db.findById(req.params.id);
  if (!session || session.type !== 'acp_checkout_session') return acpError(res, 404, 'not_found', 'Checkout session not found.');
  if (session.status === 'completed' || session.status === 'canceled') {
    return acpError(res, 405, 'not_cancelable', 'Checkout session cannot be canceled.');
  }

  const canceled = db.update(session.id, {
    status: 'canceled',
    transfer_state: 'canceled',
    updatedAt: nowIso()
  });
  res.json(buildCheckoutSession(req, canceled));
});

app.get(`${ACP_BASE_PATH}/orders/:id`, (req, res) => {
  const session = db.list().find((record) => record.merchant_order_id === req.params.id || record.id === req.params.id);
  if (!session || !session.order) return acpError(res, 404, 'not_found', 'Order not found.');
  res.json(session.order);
});

app.get('/api/orders', (req, res) => {
  const records = db.list().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json(records);
});

app.post('/api/demo/approve/:id', (req, res) => {
  const updated = db.update(req.params.id, {
    status: 'ready_for_payment',
    transfer_state: 'ready_for_transfer',
    humanApprovedAt: nowIso(),
    updatedAt: nowIso()
  });
  if (!updated) return acpError(res, 404, 'not_found', 'Checkout session not found.');
  res.json({ success: true, checkout_session: updated });
});

app.post('/api/demo/reject/:id', (req, res) => {
  const updated = db.update(req.params.id, {
    status: 'canceled',
    transfer_state: 'rejected',
    updatedAt: nowIso()
  });
  if (!updated) return acpError(res, 404, 'not_found', 'Checkout session not found.');
  res.json({ success: true, checkout_session: updated });
});

app.post('/api/demo/run-x402-agent', (req, res) => {
  const child = execFile('node', ['test-agent.js'], { cwd: __dirname });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  res.json({ success: true, message: 'x402 demo agent spawned in background.' });
});

app.get('/api/premium-data', async (req, res) => {
  try {
    const upstreamHeaders = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (!value || key.toLowerCase() === 'host') return;
      if (Array.isArray(value)) value.forEach((entry) => upstreamHeaders.append(key, entry));
      else upstreamHeaders.set(key, value);
    });

    const upstreamResponse = await fetch(buildUpstreamX402Url(req), {
      method: 'GET',
      headers: upstreamHeaders
    });

    await recordX402Settlement(req, upstreamResponse);
    copyProxyHeaders(upstreamResponse.headers, res);
    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    res.status(upstreamResponse.status).send(payload);
  } catch (error) {
    console.error('[x402] premium resource proxy error:', error.message);
    res.status(502).json({
      error: 'x402 middleware service unavailable.',
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`TRON ACP x402 server: http://localhost:${PORT}`);
  console.log(`ACP checkout API: http://localhost:${PORT}${ACP_BASE_PATH}/checkout_sessions`);
  console.log(`ACP explorer: http://localhost:${PORT}/acp-explorer`);
  console.log(`x402 protected resource: http://localhost:${PORT}/api/premium-data`);
  console.log(`x402 middleware service: ${X402_SERVICE_URL}${X402_SERVICE_RESOURCE_PATH}`);
  console.log(`x402 facilitator: ${X402_FACILITATOR_URL}`);
  console.log(`Approval mode: ${TELEGRAM_MODE_ENABLED ? 'Telegram' : 'local mock approval'}`);
});
