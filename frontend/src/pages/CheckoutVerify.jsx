/**
 * CheckoutVerify — page Paystack redirects to after payment.
 * Reads ?ref=, posts to /api/payment/verify, retries once if pending.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, RotateCw } from 'lucide-react';
import { apiPost } from '../lib/api.js';

const PENDING_RETRY_MS = 2500;
const MAX_RETRIES = 1;

export default function CheckoutVerify() {
  const [state, setState] = useState({ phase: 'loading', data: null, message: '' });
  const retryCountRef = useRef(0);

  const reference =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('ref')
      : null;

  useEffect(() => {
    if (!reference) {
      setState({ phase: 'failed', data: null, message: 'Missing payment reference in URL.' });
      return;
    }

    let cancelled = false;

    async function verify() {
      try {
        const body = await apiPost('/api/payment/verify', { reference });
        if (cancelled) return;

        if (body?.pending && retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1;
          setState({ phase: 'pending', data: body.data, message: body.message });
          setTimeout(() => !cancelled && verify(), PENDING_RETRY_MS);
          return;
        }

        if (body?.status === true) {
          setState({ phase: 'success', data: body.data, message: body.message });
        } else if (body?.pending) {
          setState({ phase: 'pending', data: body.data, message: body.message });
        } else {
          setState({
            phase: 'failed',
            data: body?.data ?? null,
            message: body?.message || 'Payment could not be confirmed.',
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ phase: 'failed', data: null, message: 'Network error while verifying payment.' });
        }
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-white p-8">
        {state.phase === 'loading' && <LoadingView />}
        {state.phase === 'pending' && <PendingView message={state.message} />}
        {state.phase === 'success' && <SuccessView data={state.data} reference={reference} />}
        {state.phase === 'failed' && <FailedView message={state.message} />}
      </div>
    </div>
  );
}

function LoadingView() {
  return (
    <div className="flex flex-col items-center text-center">
      <Loader2 className="h-10 w-10 text-accent-deep animate-spin" />
      <h1 className="mt-6 text-xl font-semibold tracking-tight">Confirming your payment…</h1>
      <p className="mt-2 text-sm text-ink-secondary">Hold on — this usually takes a couple of seconds.</p>
    </div>
  );
}

function PendingView({ message }) {
  return (
    <div className="flex flex-col items-center text-center">
      <RotateCw className="h-10 w-10 text-[#B5803A] animate-spin" />
      <h1 className="mt-6 text-xl font-semibold tracking-tight">Still confirming…</h1>
      <p className="mt-2 text-sm text-ink-secondary">{message || "Paystack hasn't finalised yet. Retrying."}</p>
    </div>
  );
}

function SuccessView({ data, reference }) {
  const ngn = data?.amountNgn != null ? Number(data.amountNgn).toLocaleString('en-NG') : null;
  return (
    <div className="flex flex-col items-center text-center">
      <div className="h-14 w-14 rounded-full bg-[#E4F0E8] flex items-center justify-center">
        <CheckCircle2 className="h-8 w-8 text-[#2F7D4F]" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Payment successful</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Your device is secured. We'll email a receipt and the delivery timeline shortly.
      </p>
      <dl className="mt-8 w-full text-left text-sm border border-border-subtle rounded-xl divide-y divide-border-subtle">
        <Row label="Reference" value={reference} mono />
        {ngn && <Row label="Amount paid" value={`NGN ${ngn}`} />}
        {data?.deviceUnit?.sku && <Row label="SKU" value={data.deviceUnit.sku} mono />}
        {data?.deviceUnit?.imei && <Row label="IMEI" value={data.deviceUnit.imei} mono />}
      </dl>
      <a href="/" className="mt-8 w-full inline-flex items-center justify-center px-4 py-3 rounded-full bg-ink text-white font-semibold text-sm hover:bg-[#25252A]">
        Back to shop
      </a>
    </div>
  );
}

function FailedView({ message }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="h-14 w-14 rounded-full bg-[#F8E6E6] flex items-center justify-center">
        <XCircle className="h-8 w-8 text-[#B43A3A]" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Payment not completed</h1>
      <p className="mt-2 text-sm text-ink-secondary">{message}</p>
      <div className="mt-8 flex flex-col gap-2 w-full">
        <a href="/" className="w-full inline-flex items-center justify-center px-4 py-3 rounded-full bg-ink text-white font-semibold text-sm hover:bg-[#25252A]">
          Back to shop
        </a>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-ink-tertiary">{label}</dt>
      <dd className={`text-ink ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}
