/**
 * Storefront home page.
 *
 * - Loads available devices from GET /api/products.
 * - On Buy, prompts for email + name, then calls POST /api/payment/initialize
 *   and redirects to Paystack's hosted page.
 * - After Paystack, the user lands on /checkout/verify which finalises
 *   the order with the backend.
 */

import { useEffect, useState } from 'react';
import { ShoppingBag, ShieldCheck, Truck, RotateCw, Fingerprint, ArrowRight, Lock, Package, Smartphone } from 'lucide-react';
import { API_BASE, apiGet, apiPost } from '../lib/api.js';

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null); // product id mid-checkout

  useEffect(() => {
    apiGet('/api/products')
      .then((body) => setProducts(body?.data || []))
      .finally(() => setLoading(false));
  }, []);

  async function startCheckout(product) {
    // Quick inline prompt; replace with a proper modal/form when ready.
    const customerEmail = window.prompt('Email for receipt');
    if (!customerEmail) return;
    const customerName = window.prompt('Full name (for delivery)');
    if (!customerName) return;

    setBuying(product.id);
    try {
      const body = await apiPost('/api/payment/initialize', {
        customerEmail,
        customerName,
        deviceUnitId: product.id,
      });
      if (body?.status && body?.data?.authorization_url) {
        // Hand off to Paystack's hosted checkout.
        window.location.href = body.data.authorization_url;
        return;
      }
      alert(body?.message || 'Could not start checkout');
    } catch (err) {
      alert('Network error. Please try again.');
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Header />
      <Hero />
      <TrustStrip />

      <section id="shop" className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">Featured iPhones</h2>
          <span className="text-sm text-accent-deep">Every unit IMEI-verified</span>
        </div>

        {loading && <p className="text-sm text-ink-tertiary">Loading inventory…</p>}

        {!loading && products.length === 0 && (
          <div className="bg-white border border-border-subtle rounded-2xl p-8 text-center">
            <p className="text-ink-secondary mb-1">No devices available right now.</p>
            <p className="text-xs text-ink-tertiary">
              Sign in to the admin dashboard and add inventory to populate this page.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              busy={buying === p.id}
              onBuy={() => startCheckout(p)}
            />
          ))}
        </div>
      </section>

      <HowItWorks />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="bg-white border-b border-border-subtle">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tracking-[0.18em]">TITAN</span>
          <span className="text-[10px] tracking-[0.18em] text-accent-deep font-semibold">NIGERIA</span>
        </div>
        <nav className="hidden sm:flex gap-6 text-sm text-ink-secondary">
          <a href="#shop" className="hover:text-ink">Shop</a>
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="/admin" className="hover:text-ink">Admin</a>
        </nav>
        <a href="#" className="flex items-center gap-1.5 text-sm text-ink-secondary">
          <ShoppingBag className="h-4 w-4" />
          <span className="font-mono text-xs">0</span>
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-8 items-center">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] uppercase text-accent-deep mb-4">
          Certified refurbished
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-4">
          The iPhone you want.<br/>The price you deserve.
        </h1>
        <p className="text-ink-secondary text-base mb-7 max-w-md">
          Hand-inspected, IMEI-verified, backed by a 12-month warranty. Free Lagos delivery in 24–48 hours.
        </p>
        <div className="flex gap-3">
          <a href="#shop" className="inline-flex items-center px-5 py-3 rounded-full bg-ink text-white text-sm font-semibold hover:bg-[#25252A]">
            Shop iPhones
          </a>
          <a href="#how" className="inline-flex items-center px-5 py-3 rounded-full border border-border-strong text-sm font-semibold hover:bg-[#FBFAF7]">
            How it works
          </a>
        </div>
      </div>
      <div className="aspect-square bg-white border border-border-subtle rounded-3xl flex items-center justify-center">
        <Smartphone className="h-32 w-32 text-accent-deep" strokeWidth={1} />
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    { icon: ShieldCheck, label: '12-month warranty' },
    { icon: RotateCw, label: '30-day returns' },
    { icon: Fingerprint, label: 'IMEI verified' },
    { icon: Truck, label: 'Lagos delivery' },
  ];
  return (
    <section className="bg-white border-y border-border-subtle">
      <div className="max-w-6xl mx-auto px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2 text-sm text-ink-secondary">
            <Icon className="h-5 w-5 text-accent-deep" />
            {label}
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductCard({ product, busy, onBuy }) {
  const p = product;
  const ngn = p.priceNgn ? Number(p.priceNgn).toLocaleString('en-NG') : '—';
  const model = p.productModel;
  return (
    <article className="bg-white border border-border-subtle rounded-2xl p-5 transition hover:border-accent hover:-translate-y-0.5">
      <div className="aspect-[4/3] bg-[#FBFAF7] rounded-xl mb-4 flex items-center justify-center">
        <Smartphone className="h-16 w-16 text-ink-tertiary" strokeWidth={1} />
      </div>
      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-accent-soft text-accent-deep mb-2">
        Grade {p.cosmeticGrade?.replace('_', ' ').toLowerCase()}
      </span>
      <h3 className="text-base font-semibold tracking-tight">
        {model?.name || 'iPhone'}
      </h3>
      <p className="text-xs text-ink-tertiary mb-3">
        {model?.storageGb}GB · {model?.colorway}
      </p>
      <div className="flex gap-2 text-xs font-mono text-ink-secondary mb-4">
        <span>Battery {p.batteryHealthPct}%</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">NGN {ngn}</span>
        <button
          onClick={onBuy}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-ink text-white text-xs font-semibold hover:bg-[#25252A] disabled:opacity-60"
        >
          {busy ? 'Opening…' : <>Buy <ArrowRight className="h-3 w-3" /></>}
        </button>
      </div>
    </article>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Smartphone, title: 'Choose your device', body: 'Every unit has its own grade, battery health, and IMEI on the page.' },
    { icon: Lock, title: 'Pay securely', body: 'Paystack handles card, bank transfer, and USSD in one place.' },
    { icon: Package, title: 'Receive in 24–48h', body: 'Free Lagos delivery. Nationwide via DHL with insured tracking.' },
  ];
  return (
    <section id="how" className="max-w-6xl mx-auto px-6 py-16">
      <h2 className="text-2xl font-semibold tracking-tight mb-8">How it works</h2>
      <div className="grid md:grid-cols-3 gap-5">
        {steps.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-white border border-border-subtle rounded-2xl p-6">
            <Icon className="h-7 w-7 text-accent-deep mb-3" strokeWidth={1.5} />
            <h3 className="text-base font-semibold mb-1.5">{title}</h3>
            <p className="text-sm text-ink-tertiary leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-white border-t border-border-subtle">
      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs tracking-[0.14em] text-ink-tertiary">
          TITAN NIGERIA · ALL DEVICES IMEI-VERIFIED
        </div>
        <div className="flex gap-2 text-xs">
          {['Card', 'Bank transfer', 'USSD'].map((c) => (
            <span key={c} className="px-2.5 py-1 rounded-full bg-[#FBFAF7] border border-border-subtle text-ink-secondary">
              {c}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
