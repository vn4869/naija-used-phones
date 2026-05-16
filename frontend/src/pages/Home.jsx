/**
 * Storefront home page.
 * Enhanced with official retail product renders for full premium visual identity.
 */

import { useEffect, useState } from 'react';
import { ShoppingBag, ShieldCheck, Truck, RotateCw, Fingerprint, ArrowRight, Lock, Package, Smartphone } from 'lucide-react';
import { API_BASE, apiGet, apiPost } from '../lib/api.js';

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null);

  useEffect(() => {
    apiGet('/api/products')
      .then((body) => setProducts(body?.data || []))
      .finally(() => setLoading(false));
  }, []);

  async function startCheckout(product) {
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
          <span className="text-sm text-accent-deep font-medium">Every unit IMEI-verified</span>
        </div>

        {loading && <p className="text-sm text-ink-tertiary">Loading inventory…</p>}

       {!loading && products.length === 0 && (
          <div className="bg-white border border-border-subtle rounded-2xl p-8 text-center">
            <p className="text-base font-semibold text-ink mb-2">New arrivals coming soon!</p>
            <p className="text-xs text-ink-tertiary">
              Our curated premium inventory is updated daily. Check back shortly.
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
          <a href="#shop" className="hover:text-ink transition">Shop</a>
          <a href="#how" className="hover:text-ink transition">How it works</a>
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
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-accent-deep mb-3">
            Certified refurbished
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-4">
            The iPhone you want.<br/>The price you deserve.
          </h1>
          <p className="text-ink-secondary text-base max-w-md leading-relaxed">
            Hand-inspected, IMEI-verified, backed by a 12-month warranty. Free Lagos delivery in 24–48 hours.
          </p>
        </div>
        <div className="flex gap-3">
          <a href="#shop" className="inline-flex items-center px-5 py-3 rounded-full bg-ink text-white text-sm font-semibold hover:bg-[#25252A] transition shadow-sm">
            Shop iPhones
          </a>
          <a href="#how" className="inline-flex items-center px-5 py-3 rounded-full border border-border-strong text-sm font-semibold hover:bg-[#FBFAF7] transition">
            How it works
          </a>
        </div>
      </div>
      {/* 📸 爆改点一：首页右侧完美的 iPhone 15 Pro Max 官方实物大图悬浮展示 */}
      <div className="aspect-square bg-white border border-border-subtle rounded-3xl flex items-center justify-center p-8 overflow-hidden shadow-sm hover:scale-[1.01] transition-transform duration-3xl">
        <img 
          src="/iphone.png"
          alt="Premium iPhone Display"
          className="h-full w-full object-contain filter drop-shadow-xl"
        />
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

  // 💡 爆改点二：根据录入的型号自动匹配对应的高清产品切图（默认采用万能的正面精美商品图）
  const getProductImage = (modelName) => {
    const name = modelName?.toLowerCase() || '';
    if (name.includes('15')) return "https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=400&q=80";
    if (name.includes('14')) return "https://images.unsplash.com/photo-1663499482523-1c0c1ebe4cc2?auto=format&fit=crop&w=400&q=80";
    return "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=400&q=80";
  };

  return (
    <article className="bg-white border border-border-subtle rounded-2xl p-5 transition duration-300 hover:border-ink-tertiary hover:-translate-y-0.5 shadow-sm">
      <div className="aspect-[4/3] bg-[#FBFAF7] rounded-xl mb-4 flex items-center justify-center p-4 overflow-hidden">
        <img 
          src={getProductImage(model?.name)} 
          alt={model?.name || 'iPhone'} 
          className="h-full object-contain filter drop-shadow-md hover:scale-105 transition-transform"
        />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-ink text-white uppercase tracking-wider">
            Grade {p.cosmeticGrade?.replace('_', ' ').toLowerCase()}
          </span>
          <span className="text-[11px] font-mono text-ink-tertiary">
            Battery {p.batteryHealthPct}%
          </span>
        </div>
        <div>
          <h3 className="text-base font-semibold tracking-tight text-ink">
            {model?.name || 'iPhone'}
          </h3>
          <p className="text-xs text-ink-tertiary">
            {model?.storageGb || 128}GB · {model?.colorway || 'Selected Grade'}
          </p>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
          <span className="text-base font-semibold tracking-tight font-mono text-ink">NGN {ngn}</span>
          <button
            onClick={onBuy}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-ink text-white text-xs font-semibold hover:bg-[#25252A] transition disabled:opacity-60"
          >
            {busy ? 'Opening…' : <>Buy <ArrowRight className="h-3 w-3" /></>}
          </button>
        </div>
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
          <div key={title} className="bg-white border border-border-subtle rounded-2xl p-6 shadow-sm">
            <Icon className="h-6 w-6 text-accent-deep mb-3" strokeWidth={1.5} />
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
        <div className="text-xs tracking-[0.14em] text-ink-tertiary font-medium">
          TITAN NIGERIA · ALL DEVICES IMEI-VERIFIED
        </div>
        <div className="flex gap-2 text-xs">
          {['Card', 'Bank transfer', 'USSD'].map((c) => (
            <span key={c} className="px-2.5 py-1 rounded-full bg-[#FBFAF7] border border-border-subtle text-ink-secondary font-mono">
              {c}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
