import { appName, AppBrandMark } from '@/components/AppBrand';
import { useEffect, useState } from 'react';
import { BellRing, Clock3, PhoneCall, PhoneOff } from 'lucide-react';
import type { QueueRequest } from '@/types/queue';
import type { ConnectionStatus } from '@/pages/Portal';
import { categoryLabel, usePassengerI18n } from '@/lib/passengerI18n';

export function useWaitTime(since: number, offset: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now + offset - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function QueueItem({ request, offset, onSelect }: { request: QueueRequest; offset: number; onSelect: () => void }) {
  const wait = useWaitTime(request.waitingSince, offset);
  return <button type="button" className="queue-item" onClick={onSelect}><span><strong>{request.passengerName}</strong><b>{wait}</b></span><span>{request.serviceCategory}</span><small>{request.language} · {request.passengerOnline ? 'Menunggu' : 'Koneksi terputus'}</small></button>;
}

export function PassengerWaiting({ request, offset, status, onCancel, onRelease, onDismiss }: { request: QueueRequest; offset: number; status: ConnectionStatus; onCancel: () => Promise<unknown>; onRelease: () => Promise<unknown>; onDismiss: () => Promise<unknown> }) {
  const { t } = usePassengerI18n()!;
  const wait = useWaitTime(request.waitingSince, offset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const waiting = request.status === 'waiting';
  const accepted = request.status === 'accepted';
  const message = t(request.status === 'rejected' ? 'rejected' : request.status === 'expired' ? 'expired' : 'cancelled');
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch { setError('error'); } finally { setBusy(false); } };
  return <div className="portal-page device-page"><header className="device-header"><AppBrandMark /><div><h1 lang="en">{appName}</h1><p>{t('serviceTitle')}</p></div></header>
    <main className="waiting-main"><h2>{t('help')}</h2><div className="waiting-details"><strong dir="auto">{request.passengerName}</strong><span>{categoryLabel(request.serviceCategory,t)}</span><span>{t('connection')}: {t(status === 'connected' ? 'ready' : status === 'connecting' ? 'connecting' : 'disconnected')}</span></div>
      <div className="waiting-card"><span className="waiting-icon"><PhoneCall aria-hidden="true" /></span><h3>{t(waiting ? 'waiting' : accepted ? 'accepted' : 'requestEnded')}</h3><p>{waiting ? t('waitingInfo') : accepted ? t('acceptedInfo') : message}</p>{waiting && <strong className="waiting-timer" dir="ltr" aria-label={t('waitTime')}>{wait}</strong>}</div>
      {status !== 'connected' && <p className="queue-message">{t('connectionLost')}</p>}{error && <p role="alert" className="device-error">{t('genericError')}</p>}
      <button type="button" className="queue-secondary call-control-no-select" onContextMenu={e => e.preventDefault()} disabled={busy || status !== 'connected'} onClick={() => action(waiting ? onCancel : accepted ? onRelease : onDismiss)}>{t(busy ? 'processing' : waiting ? 'cancelRequest' : accepted ? 'endPreparation' : 'backCheck')}</button>
    </main></div>;
}

function IncomingWaitTime({ since, offset }: { since: number; offset: number }) {
  const wait = useWaitTime(since, offset);
  return <div className="incoming-time" role="timer" aria-labelledby="incoming-time-label">
    <Clock3 aria-hidden="true" />
    <div>
      <span id="incoming-time-label">Lama Penumpang Menunggu</span>
      <strong dir="ltr">{wait.padStart(5, '0')}</strong>
    </div>
  </div>;
}

export function OfficerIncoming({ request, offset, status, onBack, onAccept, onReject }: { request: QueueRequest | undefined; offset: number; status: ConnectionStatus; onBack: () => void; onAccept: () => Promise<unknown>; onReject: () => Promise<unknown> }) {
  const [lastRequest, setLastRequest] = useState(request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connected = status === 'connected';
  useEffect(() => {
    if (connected) setLastRequest(request);
  }, [connected, request]);
  // The queue is cleared on disconnect. Keep the last request visible until a fresh snapshot arrives.
  const visibleRequest = connected ? request : lastRequest;
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Permintaan gagal. Coba lagi.'); } finally { setBusy(false); } };
  return <main className="incoming-page">
    <div className="incoming-wrap">
      <header className="incoming-brand"><AppBrandMark /><h1 lang="en">{appName}</h1></header>
      <div className="incoming-bell"><BellRing aria-hidden="true" /></div>
      <div className="incoming-card">
        <div className="incoming-category"><span>KATEGORI LAYANAN</span><strong>{visibleRequest?.serviceCategory || 'Permintaan tidak tersedia'}</strong></div>
        <div className="incoming-content">
          {visibleRequest ? <>
            <p><strong>{visibleRequest.passengerName}</strong> · {visibleRequest.language}</p>
            <IncomingWaitTime since={visibleRequest.waitingSince} offset={offset} />
            {!connected ? <p className="queue-message" role="status">Koneksi ke server terputus. Tunggu koneksi kembali.</p> : !visibleRequest.passengerOnline && <p className="queue-message">Penumpang terputus. Tunggu koneksi kembali.</p>}
            <div className="incoming-actions">
              <button className="incoming-accept call-control-no-select" disabled={busy || !connected || !visibleRequest.passengerOnline} onClick={() => action(onAccept)} onContextMenu={e => e.preventDefault()}><PhoneCall aria-hidden="true" />Accept Call</button>
              <button className="incoming-reject call-control-no-select" disabled={busy || !connected} onClick={() => action(onReject)} onContextMenu={e => e.preventDefault()}><PhoneOff aria-hidden="true" />Reject Call</button>
            </div>
          </> : <p>Permintaan sudah dibatalkan, diterima, atau tidak tersedia.</p>}
          {error && <p role="alert" className="device-error">{error}</p>}
        </div>
      </div>
      <button className="incoming-back" disabled={busy} onClick={onBack}>← Kembali ke Dashboard</button>
    </div>
  </main>;
}
