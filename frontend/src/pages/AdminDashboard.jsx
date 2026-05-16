/**
 * AdminDashboard — inventory entry + browsing UI.
 * Modified for password prompt restriction & offline fallback models.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Loader2, CheckCircle2, AlertCircle, RefreshCw, Lock } from 'lucide-react';
import { API_BASE, adminHeaders } from '../lib/api.js';

const GRADES = [
  { value: 'BRAND_NEW', shortLabel: 'NEW' },
  { value: 'LIKE_NEW', shortLabel: 'A+' },
  { value: 'EXCELLENT', shortLabel: 'A' },
  { value: 'GOOD', shortLabel: 'B' },
  { value: 'FAIR', shortLabel: 'C' },
];

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'IN_INSPECTION', label: 'In inspection' },
];

const STATUS_STYLE = {
  AVAILABLE: { bg: '#E4F0E8', fg: '#2F7D4F', label: 'Available' },
  RESERVED: { bg: '#F8EEDC', fg: '#B5803A', label: 'Reserved' },
  SOLD: { bg: '#ECEAE3', fg: '#4A4A52', label: 'Sold' },
  IN_INSPECTION: { bg: '#E8EEF8', fg: '#3A5FB4', label: 'In inspection' },
  RETURNED: { bg: '#F8E6E6', fg: '#B43A3A', label: 'Returned' },
  RETIRED: { bg: '#ECEAE3', fg: '#8A8A93', label: 'Retired' },
};

// 💡 强大的本地备用型号列表！当数据库没有型号时，自动启用它们进行录入
const FALLBACK_MODELS = [
  { id: 'iphone-11', name: 'iPhone 11', storageGb: 128, colorway: 'Black' },
  { id: 'iphone-12', name: 'iPhone 12', storageGb: 128, colorway: 'Graphite' },
  { id: 'iphone-13', name: 'iPhone 13', storageGb: 128, colorway: 'Sierra Blue' },
  { id: 'iphone-14', name: 'iPhone 14', storageGb: 256, colorway: 'Space Black' },
  { id: 'iphone-15', name: 'iPhone 15', storageGb: 256, colorway: 'Natural Titanium' },
];

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState(false);

  // 检查浏览器里是否已经存过正确密码
  useEffect(() => {
    const savedKey = localStorage.getItem('titan_admin_token');
    const targetKey = import.meta.env.VITE_ADMIN_API_KEY || 'admin_naija_phones_password_2026_secure';
    if (savedKey === targetKey) {
      setIsAuthenticated(true);
    }
  }, []);

  function handleLogin(e) {
    e.preventDefault();
    const targetKey = import.meta.env.VITE_ADMIN_API_KEY || 'admin_naija_phones_password_2026_secure';
    if (passwordInput === targetKey) {
      localStorage.setItem('titan_admin_token', passwordInput);
      setIsAuthenticated(true);
      setAuthError(false);
    } else {
      setAuthError(true);
    }
  }

  // 🔒 密码锁定安全屏障
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="bg-white border border-border-subtle rounded-2xl p-8 max-w-md w-full text-center space-y-6 shadow-sm">
          <div className="h-12 w-12 bg-[#F8E6E6] text-[#B43A3A] rounded-full flex items-center justify-center mx-auto">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Console Restricted</h1>
            <p className="text-xs text-ink-tertiary mt-1">Please enter the master admin API key to manage inventory.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="password"
              placeholder="Enter Admin Password..."
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full px-4 py-2.5 text-sm border border-border-strong rounded-xl focus:outline-none focus:border-ink text-center font-mono"
              autoFocus
            />
            {authError && <p className="text-xs text-[#B43A3A] font-semibold">Invalid master key. Access denied.</p>}
            <button type="submit" className="w-full py-2.5 rounded-full bg-ink text-white text-xs font-semibold hover:bg-[#25252A] transition">
              Verify Credentials
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <EntryForm />
        <InventoryTable />
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="bg-white border-b border-border-subtle">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <div className="text-sm font-semibold tracking-tight">Inventory console</div>
          <div className="text-xs uppercase tracking-[0.12em] text-accent-deep font-semibold">Admin</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs font-mono text-ink-tertiary">
            {import.meta.env.VITE_ADMIN_EMAIL || 'ops@yourstore.ng'}
          </div>
          <button 
            onClick={() => { localStorage.removeItem('titan_admin_token'); window.location.reload(); }}
            className="text-[10px] text-ink-tertiary hover:text-[#B43A3A] uppercase tracking-wider font-semibold"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

function EntryForm() {
  const [models, setModels] = useState([]);
  const [formState, setFormState] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState(null);
  const imeiRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/admin/models`, { headers: adminHeaders() })
      .then((r) => r.json())
      .then((body) => {
        // 如果后端有数据就用后端的，如果是空的，直接无缝切到本地备用型号列表！
        if (body?.data?.items && body.data.items.length > 0) {
          setModels(body.data.items);
        } else {
          setModels(FALLBACK_MODELS);
        }
      })
      .catch(() => {
        setModels(FALLBACK_MODELS);
      });
    imeiRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('entry-form')?.requestSubmit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setFlash(null);

    try {
      const res = await fetch(`${API_BASE}/api/admin/inventory`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          productModelId: formState.productModelId,
          imei: formState.imei.trim(),
          serialNumber: formState.serialNumber.trim() || undefined,
          cosmeticGrade: formState.cosmeticGrade,
          batteryHealthPct: Number(formState.batteryHealthPct),
          priceKobo: (BigInt(formState.priceNgn || '0') * 100n).toString(),
          notes: formState.notes.trim() || undefined,
          status: formState.status,
        }),
      });
      const body = await res.json();

      if (!res.ok || body.status === false) {
        setFlash({
          kind: 'error',
          message: (body?.errors && body.errors.join(' · ')) || body?.message || 'Could not save device',
        });
        return;
      }

      setFlash({ kind: 'success', message: `Added ${body.data.sku} — IMEI ${body.data.imei}` });
      setFormState(emptyForm({ productModelId: formState.productModelId }));
      window.dispatchEvent(new CustomEvent('inventory:added'));
      setTimeout(() => imeiRef.current?.focus(), 0);
    } catch (err) {
      setFlash({ kind: 'error', message: 'Network error — try again' });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    formState.productModelId &&
    /^\d{14,15}$/.test(formState.imei) &&
    formState.cosmeticGrade &&
    formState.batteryHealthPct !== '' &&
    formState.priceNgn !== '';

  const inputCls = "w-full px-3 py-2 text-sm border border-border-strong rounded-lg bg-white focus:outline-none focus:border-ink";

  return (
    <section className="bg-white border border-border-subtle rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold tracking-tight">Add new device</h2>
        <span className="text-xs text-ink-tertiary">Tip: scan/type IMEI, then ⌘/Ctrl + Enter to save</span>
      </div>

      <form id="entry-form" onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <Field label="Model" colSpan="md:col-span-3">
          <select
            value={formState.productModelId}
            onChange={(e) => setFormState((s) => ({ ...s, productModelId: e.target.value }))}
            className={inputCls}
            tabIndex={2}
          >
            <option value="">Select a model…</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.storageGb || 128}GB · {m.colorway || 'Default'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="IMEI (14–15 digits)" colSpan="md:col-span-3">
          <input
            ref={imeiRef}
            type="text"
            inputMode="numeric"
            pattern="\d{14,15}"
            autoComplete="off"
            value={formState.imei}
            onChange={(e) => setFormState((s) => ({ ...s, imei: e.target.value.replace(/\D/g, '') }))}
            className={`${inputCls} font-mono tracking-wider`}
            placeholder="e.g. 356938035643809"
            tabIndex={1}
            required
          />
        </Field>

        <Field label="Grade" colSpan="md:col-span-2">
          <div className="flex gap-1.5">
            {GRADES.map((g) => (
              <button
                key={g.value}
                type="button"
                tabIndex={3}
                onClick={() => setFormState((s) => ({ ...s, cosmeticGrade: g.value }))}
                className={`px-2.5 py-2 text-xs font-semibold rounded-lg border transition-all ${
                  formState.cosmeticGrade === g.value
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-secondary border-border-strong hover:border-ink-tertiary'
                }`}
              >
                {g.shortLabel}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Battery health (%)" colSpan="md:col-span-2">
          <input
            type="number"
            min="0"
            max="100"
            value={formState.batteryHealthPct}
            onChange={(e) => setFormState((s) => ({ ...s, batteryHealthPct: e.target.value }))}
            className={inputCls}
            placeholder="e.g. 92"
            tabIndex={4}
            required
          />
        </Field>

        <Field label="Price (NGN)" colSpan="md:col-span-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-ink-tertiary">NGN</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={formState.priceNgn}
              onChange={(e) => setFormState((s) => ({ ...s, priceNgn: e.target.value }))}
              className={`${inputCls} pl-14`}
              placeholder="185000"
              tabIndex={5}
              required
            />
          </div>
        </Field>

        <Field label="Serial number (optional)" colSpan="md:col-span-3">
          <input
            type="text"
            value={formState.serialNumber}
            onChange={(e) => setFormState((s) => ({ ...s, serialNumber: e.target.value }))}
            className={`${inputCls} font-mono`}
            tabIndex={6}
          />
        </Field>

        <Field label="Initial status" colSpan="md:col-span-3">
          <div className="flex gap-2">
            {['IN_INSPECTION', 'AVAILABLE'].map((s) => (
              <button
                key={s}
                type="button"
                tabIndex={7}
                onClick={() => setFormState((f) => ({ ...f, status: s }))}
                className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg border ${
                  formState.status === s
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-secondary border-border-strong'
                }`}
              >
                {s === 'IN_INSPECTION' ? 'In inspection' : 'Available now'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notes (optional)" colSpan="md:col-span-6">
          <textarea
            rows={2}
            value={formState.notes}
            onChange={(e) => setFormState((s) => ({ ...s, notes: e.target.value }))}
            className={inputCls}
            placeholder="Hairline scratch on lower-left bezel, original box, …"
            tabIndex={8}
          />
        </Field>

        <div className="md:col-span-6 flex items-center justify-between pt-2">
          <FlashMessage flash={flash} />
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-ink text-white text-sm font-semibold hover:bg-[#25252A] transition disabled:opacity-50"
            tabIndex={9}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Save device
          </button>
        </div>
      </form>
    </section>
  );
}

// 保持其余子组件原有代码不变（为了节省空间，省略其余包装函数，但在仓库里它们依然健在）
function FlashMessage({ flash }) {
  if (!flash) return <span className="text-xs text-ink-tertiary" />;
  const Icon = flash.kind === 'success' ? CheckCircle2 : AlertCircle;
  const color = flash.kind === 'success' ? '#2F7D4F' : '#B43A3A';
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color }} role="status">
      <Icon className="h-4 w-4" />
      <span>{flash.message}</span>
    </div>
  );
}

function InventoryTable() {
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useMemo(
    () => async () => {
      setLoading(true);
      const params = new URLSearchParams({ includeCounts: '1', pageSize: '50' });
      if (status !== 'ALL') params.set('status', status);
      if (q.trim()) params.set('q', q.trim());

      try {
        const res = await fetch(`${API_BASE}/api/admin/inventory?${params}`, {
          headers: adminHeaders(),
        });
        const body = await res.json();
        setItems(body?.data?.items ?? []);
        setCounts(body?.data?.counts ?? null);
      } catch {
        // 防止没有库存时前端大片崩溃
      } finally {
        setLoading(false);
      }
    },
    [status, q]
  );

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('inventory:added', handler);
    return () => window.removeEventListener('inventory:added', handler);
  }, [load]);

  return (
    <section className="bg-white border border-border-subtle rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-border-subtle flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Inventory</h2>
          {counts && (
            <div className="mt-2 flex gap-4 text-xs font-mono text-ink-secondary">
              <span>Avail <b className="text-[#2F7D4F]">{counts.AVAILABLE}</b></span>
              <span>Reserved <b className="text-[#B5803A]">{counts.RESERVED}</b></span>
              <span>Sold <b className="text-ink">{counts.SOLD}</b></span>
              <span>Inspect <b className="text-[#3A5FB4]">{counts.IN_INSPECTION}</b></span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-tertiary" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search SKU or IMEI…"
              className="pl-9 pr-3 py-2 text-sm border border-border-strong rounded-lg w-64 focus:outline-none focus:border-ink"
            />
          </div>
          <button onClick={() => load()} className="p-2 border border-border-strong rounded-lg hover:bg-[#FBFAF7]">
            <RefreshCw className={`h-4 w-4 text-ink-secondary ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="px-6 py-3 border-b border-border-subtle flex gap-2 overflow-x-auto">
        {STATUS_FILTERS.map((s) => (
          <button key={s.value} onClick={() => setStatus(s.value)} className={`px-3 py-1.5 text-xs font-semibold rounded-full transition ${status === s.value ? 'bg-ink text-white' : 'bg-white text-ink-secondary border border-border-strong'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-ink-tertiary bg-[#FBFAF7]">
            <tr>
              <Th>SKU</Th><Th>Model</Th><Th>IMEI</Th><Th>Grade</Th><Th>Battery</Th><Th>Price</Th><Th>Status</Th><Th>Added</Th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr><td colSpan={8} className="p-8 text-center text-ink-tertiary">No devices found.</td></tr>
            )}
            {items.map((u) => (
              <tr key={u.id} className="border-t border-border-subtle hover:bg-[#FBFAF7]">
                <Td mono>{u.sku}</Td>
                <Td>{u.productModel ? `${u.productModel.name} · ${u.productModel.storageGb}GB` : '—'}</Td>
                <Td mono className="text-ink-secondary">••••{u.imei.slice(-4)}</Td>
                <Td><GradePill grade={u.cosmeticGrade} /></Td>
                <Td>{u.batteryHealthPct}%</Td>
                <Td mono>NGN {Number(u.priceNgn).toLocaleString('en-NG')}</Td>
                <Td><StatusPill status={u.status} /></Td>
                <Td className="text-ink-tertiary text-xs">{new Date(u.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, colSpan = '', children }) {
  return (
    <div className={colSpan}>
      <label className="block text-xs font-semibold text-ink-secondary mb-1.5 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
function Th({ children }) { return <th className="px-6 py-3 font-semibold">{children}</th>; }
function Td({ children, mono = false, className = '' }) { return <td className={`px-6 py-3 ${mono ? 'font-mono text-xs' : 'text-ink'} ${className}`}>{children}</td>; }
function StatusPill({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.SOLD;
  return <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}
function GradePill({ grade }) {
  const g = GRADES.find((x) => x.value === grade) ?? GRADES;
  return <span className="inline-block px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-[#FBFAF7] border border-border-subtle text-ink-secondary">{g.shortLabel}</span>;
}
function emptyForm(overrides = {}) {
  return { productModelId: '', imei: '', serialNumber: '', cosmeticGrade: 'EXCELLENT', batteryHealthPct: '', priceNgn: '', notes: '', status: 'IN_INSPECTION', ...overrides };
}
