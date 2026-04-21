import { createElement, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  CreditCard,
  ExternalLink,
  Play,
  RefreshCw,
  Terminal,
  Wallet,
  X
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const money = (baseUnits = 0) => `${(Number(baseUnits) / 1_000_000).toFixed(2)} USDT`;

function StatusBadge({ status }) {
  const className = {
    completed: 'badge badge-green',
    ready_for_payment: 'badge badge-blue',
    pending_approval: 'badge badge-amber',
    complete_in_progress: 'badge badge-blue',
    canceled: 'badge badge-red'
  }[status] || 'badge';

  return <span className={className}>{status || 'unknown'}</span>;
}

function Stat({ icon, label, value }) {
  return (
    <div className="stat">
      <div className="stat-icon">{createElement(icon, { size: 18 })}</div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}

function SessionRow({ session, onApprove, onReject }) {
  const age = session.createdAt ? formatDistanceToNow(new Date(session.createdAt), { addSuffix: true }) : 'unknown';
  const handler = session.payment_protocol === 'acp_tron_trc20_usdt';

  return (
    <article className="row-card">
      <div className="row-main">
        <div className="row-title">
          <span>{session.id}</span>
          <StatusBadge status={session.status} />
        </div>
        <div className="row-meta">
          <span>{handler ? 'ACP TRON checkout' : 'x402 payment'}</span>
          <span>{age}</span>
          {session.txHash ? <span className="hash">{session.txHash.slice(0, 10)}...{session.txHash.slice(-8)}</span> : null}
        </div>
      </div>
      <div className="row-amount">{money(session.amount_in_base_units)}</div>
      {session.status === 'pending_approval' ? (
        <div className="row-actions">
          <button className="icon-button success" title="Approve checkout" onClick={() => onApprove(session.id)}><Check size={18} /></button>
          <button className="icon-button danger" title="Reject checkout" onClick={() => onReject(session.id)}><X size={18} /></button>
        </div>
      ) : null}
    </article>
  );
}

function AgentModal({ open, onClose, onRun }) {
  const [steps, setSteps] = useState([]);

  useEffect(() => {
    if (!open) return undefined;
    const timeline = [
      [300, 'Agent VM started'],
      [1200, 'Requesting /api/premium-data'],
      [2600, 'Received HTTP 402 challenge'],
      [4200, 'Selecting TRON Nile USDT payment requirement'],
      [6400, 'Signing x402 payment payload'],
      [8200, 'Retrying with PAYMENT-SIGNATURE'],
      [11000, 'Facilitator verification and settlement complete'],
      [12600, 'Premium payload returned']
    ];
    const timers = timeline.map(([delay, label]) => setTimeout(() => {
      setSteps((existing) => [...existing, label]);
    }, delay));
    onRun();
    return () => timers.forEach(clearTimeout);
  }, [open, onRun]);

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <header className="modal-header">
          <div className="modal-title"><Terminal size={18} /> x402 Agent Run</div>
          <button className="icon-button" title="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="terminal">
          {steps.map((step) => (
            <div className="terminal-line" key={step}><span>$</span>{step}</div>
          ))}
          <div className="terminal-line muted"><span>$</span><span className="cursor">processing</span></div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/orders`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setRecords(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const timer = setInterval(loadOrders, 5000);
    return () => clearInterval(timer);
  }, []);

  const metrics = useMemo(() => {
    const acp = records.filter((record) => record.payment_protocol === 'acp_tron_trc20_usdt');
    const x402 = records.filter((record) => record.payment_protocol === 'bankofai_x402');
    const paid = records.filter((record) => ['completed', 'PAID'].includes(record.status));
    const volume = paid.reduce((sum, record) => sum + Number(record.amount_in_base_units || 0), 0);
    return { acp: acp.length, x402: x402.length, paid: paid.length, volume };
  }, [records]);

  const approve = async (id) => {
    await fetch(`${API_BASE}/api/demo/approve/${id}`, { method: 'POST' });
    loadOrders();
  };

  const reject = async (id) => {
    await fetch(`${API_BASE}/api/demo/reject/${id}`, { method: 'POST' });
    loadOrders();
  };

  const createCheckout = async () => {
    await fetch(`${API_BASE}/agentic_commerce/checkout_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Version': '2026-04-17',
        'Idempotency-Key': `dashboard-${Date.now()}`
      },
      body: JSON.stringify({ items: [{ id: 'premium_data_access', quantity: 1 }] })
    });
    loadOrders();
  };

  const runX402Agent = async () => {
    await fetch(`${API_BASE}/api/demo/run-x402-agent`, { method: 'POST' }).catch(() => {});
    setTimeout(loadOrders, 14000);
  };

  return (
    <main className="app-shell">
      <AgentModal open={modalOpen} onClose={() => setModalOpen(false)} onRun={runX402Agent} />

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <strong>TRON ACP</strong>
            <span>x402 demo</span>
          </div>
        </div>
        <nav>
          <a className="active" href="#overview"><Activity size={18} /> Overview</a>
          <a href={`${API_BASE}/acp-explorer`} target="_blank" rel="noreferrer"><ExternalLink size={18} /> ACP Explorer</a>
          <a href={`${API_BASE}/agentic_commerce/checkout_sessions/example`} target="_blank" rel="noreferrer"><ExternalLink size={18} /> Checkout API</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Agentic Commerce Control Room</h1>
            <p>ACP checkout sessions and x402 protected-resource payments on TRON Nile.</p>
          </div>
          <div className="actions">
            <button className="button secondary" onClick={loadOrders} disabled={loading}><RefreshCw size={18} /> Refresh</button>
            <button className="button secondary" onClick={createCheckout}><CreditCard size={18} /> New ACP Session</button>
            <button className="button primary" onClick={() => setModalOpen(true)}><Play size={18} /> Run x402 Agent</button>
          </div>
        </header>

        <section className="stats-grid">
          <Stat icon={CreditCard} label="ACP sessions" value={metrics.acp} />
          <Stat icon={Activity} label="x402 payments" value={metrics.x402} />
          <Stat icon={Check} label="Completed" value={metrics.paid} />
          <Stat icon={Wallet} label="Volume" value={money(metrics.volume)} />
        </section>

        <section className="protocol-band">
          <div>
            <h2>TRON ACP Payment Handler</h2>
            <p>Agents receive an ACP payment handler that encodes the TRON Nile network, TRC20 USDT contract, merchant receiver, exact amount, and receipt credential schema.</p>
          </div>
          <a className="button secondary" href={`${API_BASE}/public/tron-nile-acp-handler.json`} target="_blank" rel="noreferrer">
            <ExternalLink size={18} /> Handler JSON
          </a>
        </section>

        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>Orders and Sessions</h2>
              <p>{loading ? 'Loading records' : `${records.length} records in local storage`}</p>
            </div>
            {error ? <span className="error">API error: {error}</span> : null}
          </div>

          <div className="rows">
            {records.length === 0 && !loading ? (
              <div className="empty">
                <Clock size={22} />
                <span>No records yet</span>
              </div>
            ) : null}
            {records.map((record) => (
              <SessionRow key={record.id} session={record} onApprove={approve} onReject={reject} />
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
