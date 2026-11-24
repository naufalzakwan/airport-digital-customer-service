import { appName, AppBrandMark } from '@/components/AppBrand';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Accessibility, Box, CircleUserRound, Globe2, Headphones, LogIn, MessageCircleQuestion, Plane } from 'lucide-react';
import './Portal.css';
import DeviceCheck from '@/components/DeviceCheck';
import OfficerSettings from '@/components/OfficerSettings';
import CallReference from '@/components/CallReference';
import RecentCalls from '@/components/RecentCalls';
import { useQueue } from '@/hooks/useQueue';
import { OfficerIncoming, PassengerWaiting, QueueItem } from '@/components/QueueViews';
import { QueueCallScreen, QueueCallResult } from '@/components/QueueCallScreen';
import { OfficerReview, PassengerRating, durationLabel } from '@/components/CallReview';
import type { CallDashboard, CallRecord } from '@/types/queue';
import { PassengerI18nProvider, usePassengerI18n, languages, categoryLabel } from '@/lib/passengerI18n';

type Role = 'petugas' | 'penumpang' | 'unsupported';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type Session = { name: string; id: string };
const storageKey = 'echo-portal-name';
const activeCallLogoutMessage = 'Selesaikan panggilan atau persiapannya sebelum logout.';
const services = [
  { name: 'Flight Information', icon: Plane },
  { name: 'Lost & Found', icon: Box },
  { name: 'General Assistance', icon: MessageCircleQuestion },
  { name: 'Accessibility Services', icon: Accessibility },
];

function getRole(): Role {
  if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return 'petugas';
  return window.location.protocol === 'https:' ? 'penumpang' : 'unsupported';
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function readName() {
  try { return sessionStorage.getItem(storageKey)?.trim().slice(0, 80) || ''; } catch { return ''; }
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  return now;
}

function PortalHeader({ role, name, status, settings }: { role: Exclude<Role, 'unsupported'>; name: string; status: ConnectionStatus; settings?: ReactNode }) {
  const i18n = usePassengerI18n();
  const now = useClock();
  const time = now.toLocaleTimeString(role === 'penumpang' ? i18n?.locale : 'id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');
  const date = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  return <header className="portal-header">
    <div className="portal-header-brand"><AppBrandMark className="portal-logo compact" /><div><h1 lang="en">{appName}</h1><p>{role === 'penumpang' ? i18n?.t('dashboard') : 'Customer Service Dashboard'}</p>{role === 'penumpang' && <span>{i18n?.t('intro')}</span>}</div></div>
    <div className="portal-header-info"><div className="portal-time"><span>{role === 'penumpang' ? i18n?.t('time') : 'Current Time'}</span><strong dir="ltr">{time}</strong></div>
      {role === 'petugas' && <><div className="portal-date"><span>Date</span><strong>{date}</strong></div>{settings}<div className="portal-profile"><div><b>{status === 'connected' ? 'Online' : status === 'connecting' ? 'Connecting' : 'Offline'}</b><i className={status === 'connected' ? 'online' : ''} /></div><span className="portal-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span><strong>{name}</strong></div></>}
    </div>
  </header>;
}

function Login({ role, onLogin, loginError }: { role: Exclude<Role, 'unsupported'>; onLogin: (name: string, accessCode: string) => void; loginError: string }) {
  const t = usePassengerI18n()?.t;
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  return <main className="portal-login"><div className="portal-login-heading"><AppBrandMark className="portal-logo" /><h1 lang="en">{appName}</h1><p lang="en">LAN-Based Video Assistance System</p><p>{t ? t('portal') : 'Customer Service Portal'}</p></div>
    <form className="portal-login-card" onSubmit={event => { event.preventDefault(); const clean = name.trim(); if (!clean) { setError('required'); return; } if (role === 'petugas' && accessCode.length < 16) { setError('code'); return; } onLogin(clean, accessCode); }} noValidate>
      <label htmlFor="portal-name">{role === 'petugas' ? 'Nama Petugas' : t?.('name')}</label>
      <div className="portal-name-input"><CircleUserRound aria-hidden="true" /><input id="portal-name" placeholder={t ? t('namePlaceholder') : 'Masukkan nama Anda'} value={name} onChange={event => { setName(event.target.value); setError(''); }} maxLength={80} autoComplete="name" aria-invalid={!!error} aria-describedby={error ? 'name-error' : undefined} /></div>
      {role === 'petugas' && <div className="officer-access-field"><label htmlFor="officer-access-code">Kode akses petugas</label><div className="portal-name-input"><input id="officer-access-code" type="password" value={accessCode} onChange={event => { setAccessCode(event.target.value); setError(''); }} maxLength={128} /></div></div>}
      {(error || loginError) && <p className="portal-error" id="name-error" role="alert">{error === 'code' ? 'Masukkan kode akses petugas.' : error ? t ? t('nameRequired') : 'Nama tidak boleh kosong.' : loginError}</p>}
      <button className="portal-primary" type="submit"><LogIn aria-hidden="true" /> {t ? t('signIn') : 'Sign In'}</button>
    </form><p className="portal-demo-note"><strong lang="en">Independent Portfolio Project</strong>{t ? t('demo') : 'Konsep portofolio · Demo lokal, bukan layanan resmi'}</p></main>;
}

function Dashboard({ name, model, settings }: { name: string; model: ReturnType<typeof useQueue>; settings: ReactNode }) {
  const { status, queue, request, send, dismiss, serverOffset, connectionError } = model;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [history, setHistory] = useState<CallDashboard | null>(null);
  const [historyError, setHistoryError] = useState('');
  const historyPage = useRef<{ page: number; recentSnapshot?: number }>({ page: 1 });
  const historyRequest = useRef(0);
  const [detail, setDetail] = useState<CallRecord | null>(null);
  const [review, setReview] = useState<CallRecord | null>(null);
  const [draft, setDraft] = useState('');
  const refreshHistory = useCallback(async () => {
    const requestNumber = ++historyRequest.current;
    try {
      const { dashboard } = await send('history:dashboard', historyPage.current);
      if (requestNumber !== historyRequest.current) return;
      if (!dashboard || !dashboard.recentPageSize) throw new Error('Riwayat tidak tersedia.');
      historyPage.current = { page: dashboard.recentPage, recentSnapshot: dashboard.recentPage > 1 ? dashboard.recentSnapshot : undefined };
      setHistory(dashboard);
      setHistoryError('');
    } catch (cause) {
      if (requestNumber !== historyRequest.current) return;
      setHistoryError('Riwayat tidak tersedia. Coba lagi.');
      throw cause;
    }
  }, [send]);
  const changeHistoryPage = (page: number) => {
    historyPage.current = { page, recentSnapshot: page > 1 ? history?.recentSnapshot : undefined };
    void refreshHistory().catch(() => {});
  };
  useEffect(() => {
    if (status !== 'connected' || !model.socket) return;
    const socket = model.socket;
    const refresh = () => { void refreshHistory().catch(() => {}); };
    socket.on('history:updated', refresh); refresh();
    return () => { historyRequest.current++; socket.off('history:updated', refresh); };
  }, [status, model.socket, refreshHistory]);
  const stats = [{ label: 'CALL TODAY', value: history ? String(history.stats.callToday) : '—', detail: history ? 'Panggilan selesai hari ini' : 'Data belum tersedia' }, { label: 'AVG DURATION', value: history ? durationLabel(Math.round(history.stats.averageDurationSeconds)) : '—', detail: history ? 'Rata-rata hari ini' : 'Data belum tersedia' }, { label: 'TOTAL TIME', value: history ? durationLabel(history.stats.totalSecondsToday) : '—', detail: history ? 'Total hari ini' : 'Data belum tersedia' }, { label: 'SATISFACTION', value: history?.stats.averageRating == null ? '—' : `${history.stats.averageRating.toFixed(1)} / 5`, detail: !history ? 'Data belum tersedia' : history.stats.ratingCount ? `${history.stats.ratingCount} penilaian` : 'Belum ada penilaian' }];
  if (review) return <OfficerReview call={review} notes={draft} setNotes={setDraft} send={send} onDone={async () => { await refreshHistory(); setReview(null); }} />;
  if (detail) return <div className="portal-page"><PortalHeader role="petugas" name={name} status={status} settings={settings}/><main className="review-main"><section className="review-card"><h2>Detail Panggilan</h2><p>ID Panggilan</p><CallReference code={detail.referenceCode} /><p>Penumpang: {detail.passengerName}</p><p>Petugas: {detail.officerName}</p><p>Bahasa: {detail.language}</p><p>Kategori: {detail.serviceCategory}</p><p>Mulai: {detail.connectedAt ? new Date(detail.connectedAt).toLocaleString('id-ID') : '—'}</p><p>Selesai: {detail.endedAt ? new Date(detail.endedAt).toLocaleString('id-ID') : '—'}</p><p>Durasi: {durationLabel(detail.durationSeconds)}</p><p>Penilaian: {detail.rating === null ? 'Belum ada penilaian' : `${detail.rating}/5`}</p><h3>Catatan Layanan</h3><p className="call-note-text">{detail.callNotes || 'Tidak ada catatan.'}</p><button className="portal-primary" onClick={()=>setDetail(null)}>Kembali ke Dashboard</button></section></main></div>;
  if (selectedId && request?.status !== 'accepted') return <OfficerIncoming request={queue.find(item => item.requestId === selectedId)} offset={serverOffset} status={status} onBack={() => setSelectedId(null)} onAccept={async () => { await send('queue:accept', { requestId: selectedId }); setSelectedId(null); }} onReject={async () => { await send('queue:reject', { requestId: selectedId }); setSelectedId(null); }} />;
  return <div className="portal-page"><PortalHeader role="petugas" name={name} status={status} settings={settings} /><main className="portal-dashboard">
    <div className="portal-dashboard-inner">{connectionError && <p className="queue-banner" role="status">{connectionError}</p>}
      {request && <div className="queue-banner"><strong>{request.status === 'accepted' ? `Permintaan ${request.passengerName} diterima` : 'Persiapan panggilan telah berakhir'}</strong><p>{request.status === 'accepted' ? 'Video call belum dimulai. Integrasi media tersedia pada tahap berikutnya.' : 'Anda dapat kembali menerima permintaan lain.'}</p><button disabled={releasing || status !== 'connected'} onClick={async () => { setReleasing(true); setError(''); try { if (request.status === 'accepted') await send('queue:release', { requestId: request.requestId }); else await dismiss(); setSelectedId(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal memproses permintaan.'); } finally { setReleasing(false); } }}>{request.status === 'accepted' ? 'Akhiri persiapan' : 'Tutup'}</button>{error && <p role="alert">{error}</p>}</div>}
      <div className="portal-stats">{stats.map((stat, index) => <article className={`portal-stat stat-${index}`} key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong><p>{stat.detail}</p></article>)}</div>
      <div className="portal-panels"><section className="portal-panel"><h2>Waiting Queue <span className="portal-count">{status === 'connected' ? queue.length : '—'}</span></h2>{status !== 'connected' ? <div className="portal-empty"><Headphones aria-hidden="true" /><p>Antrean tidak tersedia saat koneksi terputus.</p></div> : queue.length ? <div className="queue-list">{queue.map(item => <QueueItem key={item.requestId} request={item} offset={serverOffset} onSelect={() => setSelectedId(item.requestId)} />)}</div> : <div className="portal-empty"><Headphones aria-hidden="true" /><p>Belum ada penumpang dalam antrean.</p></div>}</section>
      <div className="portal-panel">
        <RecentCalls history={history} error={historyError} onDetail={setDetail} onPage={changeHistoryPage} />
        {!!history?.pending.length && <section className="pending-reviews" aria-labelledby="pending-reviews-title">
          <h3 id="pending-reviews-title">Review tertunda</h3>
          {history.pending.map(call => <button type="button" key={call.callId} className="queue-item" onClick={() => {
            let local: string | null = null;
            try { local = sessionStorage.getItem('echo-notes-' + call.callId); } catch { /* Use the server draft. */ }
            setDraft(local ?? call.callNotes);
            setReview(call);
          }}><strong>Review tertunda: {call.passengerName}</strong><span>{call.referenceCode} · {call.serviceCategory} · {durationLabel(call.durationSeconds)}</span></button>)}
        </section>}
      </div></div>
    </div></main></div>;
}

function Passenger({ session, model }: { session: Session; model: ReturnType<typeof useQueue> }) {
  const { t, locale, setLocale } = usePassengerI18n()!;
  const { status, request, send, dismiss, serverOffset, connectionError } = model;
  const [service, setService] = useState('');
  const [screen, setScreen] = useState<'choices' | 'devices'>('choices');
  useEffect(() => { if (request) { setService(request.serviceCategory); setScreen('devices'); } }, [request]);
  if (request) return <PassengerWaiting request={request} offset={serverOffset} status={status} onCancel={async () => { await send('queue:cancel', { requestId: request.requestId }); await dismiss(); }} onRelease={() => send('queue:release', { requestId: request.requestId })} onDismiss={dismiss} />;
  if (screen === 'devices') return <DeviceCheck status={status} notice={connectionError} onBack={() => setScreen('choices')} onPrepare={async () => { await send('queue:join', { language: languages.find(item => item.locale === locale)!.backend, serviceCategory: service }); }} />;
  return <div className="portal-page"><PortalHeader role="penumpang" name={session.name} status={status} /><main className="portal-choices">
    {connectionError && <p className="queue-message" role="status">{t('sessionError')}</p>}
    <h2><Globe2 aria-hidden="true" /> {t('selectLanguage')}</h2><div className="portal-languages">{languages.map(item => <button key={item.locale} type="button" lang={item.locale} dir={item.locale === 'ar' ? 'rtl' : 'ltr'} aria-pressed={locale === item.locale} className={locale === item.locale ? 'selected' : ''} onClick={() => setLocale(item.locale)}>{item.label}</button>)}</div>
    <h2 className="portal-service-heading">{t('selectCategory')}</h2><div className="portal-services">{services.map(({ name: item, icon: Icon }) => <button key={item} type="button" aria-pressed={service === item} className={service === item ? 'selected' : ''} onClick={() => setService(item)}><Icon aria-hidden="true" /><span>{categoryLabel(item,t)}</span></button>)}</div>
    <div className="portal-choice-actions"><button type="button" className="portal-primary" disabled={!service} onClick={() => setScreen('devices')}>{t('continue')} <span aria-hidden="true">→</span></button></div>
  </main></div>;
}

function FinishedCall({ request, role, model, notes, setNotes }: { request: NonNullable<ReturnType<typeof useQueue>['request']>; role: 'petugas' | 'penumpang'; model: ReturnType<typeof useQueue>; notes: string; setNotes: (value: string) => void }) {
  const t = usePassengerI18n()?.t;
  const [record, setRecord] = useState<CallRecord | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (model.status !== 'connected') return; let alive = true; void model.send('history:call', {callId:request.callId}).then(result=>{if(alive && result.call) setRecord(result.call)}).catch(cause=>{if(alive)setError(cause instanceof Error ? cause.message : 'Data panggilan tidak tersedia.');}); return ()=>{alive=false}; }, [model.status, model.send, request.callId]);
  if (!record) return <div className="review-page"><main className="review-main"><p role="status">{t ? t(error ? 'genericError' : 'loading') : error || 'Memuat data panggilan...'}</p></main></div>;
  return role === 'petugas' ? <OfficerReview call={record} notes={notes} setNotes={setNotes} send={model.send} onDone={model.dismiss}/> : <PassengerRating call={record} send={model.send} onDone={model.dismiss}/>;
}

function PortalContent() {
  const passengerT = usePassengerI18n()?.t;
  const role = getRole();
  const [session, setSession] = useState<Session | null>(() => { const name = readName(); return name ? { name, id: newId() } : null; });
  const officerCode = useRef('');
  const [loginError, setLoginError] = useState('');
  const model = useQueue(session, role, officerCode);
  const [notes, setNotes] = useState('');
  const notesCall = useRef<string | null>(null);
  const notesEdited = useRef(false);
  const [notesLoaded, setNotesLoaded] = useState<string | null>(null);
  const callId = model.request?.callId;
  const clearOfficer = useCallback(() => {
    officerCode.current = '';
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem('echo-queue-token-petugas'); } catch { /* Storage is optional. */ }
    notesCall.current = null;
    notesEdited.current = false;
    setNotes('');
    setNotesLoaded(null);
    setSession(null);
  }, []);
  useEffect(() => {
    if (role !== 'petugas') return;
    if (model.authError) { setLoginError(model.authError); clearOfficer(); }
    else if (model.officerName) { try { sessionStorage.setItem(storageKey, model.officerName); } catch { /* Storage is optional. */ } }
  }, [role, model.authError, model.officerName, clearOfficer]);
  useEffect(() => {
    if (role !== 'petugas' || !callId || model.status !== 'connected' || notesCall.current === callId) return;
    let alive = true; notesCall.current = callId; notesEdited.current = false; setNotesLoaded(null);
    let local: string | null = null;
    try { local = sessionStorage.getItem(`echo-notes-${callId}`); } catch { /* Storage is optional. */ }
    void model.send('history:call', { callId }).then(result => { if (alive) { if (!notesEdited.current) setNotes(local ?? result.call?.callNotes ?? ''); setNotesLoaded(callId); } }).catch(() => { if (alive) { if (!notesEdited.current) setNotes(local ?? ''); setNotesLoaded(callId); } });
    return () => { alive = false; if (notesCall.current === callId && notesLoaded !== callId) notesCall.current = null; };
  }, [role, callId, model.status, model.send]);
  useEffect(() => {
    if (role !== 'petugas' || !callId || notesLoaded !== callId) return;
    try { sessionStorage.setItem(`echo-notes-${callId}`, notes); } catch { /* Server remains the persistent source. */ }
    if (model.status !== 'connected') return;
    const timer = setTimeout(() => { void model.send('history:notes', { callId, notes, final: false }).catch(() => {}); }, 1000);
    return () => clearTimeout(timer);
  }, [role, callId, notes, notesLoaded, model.status, model.send]);
  const setCallNotes = (value: string) => { notesEdited.current = true; setNotes(value); if (callId) { try { sessionStorage.setItem(`echo-notes-${callId}`, value); } catch { /* Draft remains in React state. */ } } };

  if (role === 'unsupported') return <main className="portal-unsupported"><AppBrandMark className="portal-logo" /><h1 lang="en">{appName}</h1><p>{passengerT?.('secureError')}</p></main>;
  if (!session) return <Login role={role} loginError={loginError} onLogin={(name, code) => {
    setLoginError('');
    if (role === 'petugas') officerCode.current = code;
    else { try { sessionStorage.setItem(storageKey, name); } catch { /* Storage is optional. */ } }
    setSession({ name, id: newId() });
  }} />;
  if (role === 'petugas' && !model.officerName) return <main className="portal-unsupported">
    <h1>Memverifikasi akses petugas</h1>
    <p role="status">{model.connectionError || 'Menunggu koneksi ke server.'}</p>
    <button type="button" className="portal-primary" onClick={clearOfficer}>Kembali ke Login</button>
  </main>;
  const activeCall = model.request?.status === 'accepted';
  const logoutOfficer = async () => {
    if (activeCall) throw new Error(activeCallLogoutMessage);
    await model.logoutOfficer();
    clearOfficer();
  };
  const settings = role === 'petugas' ? <OfficerSettings name={model.officerName} onLogout={logoutOfficer} blockedReason={activeCall ? activeCallLogoutMessage : model.status !== 'connected' ? 'Tunggu koneksi ke server kembali sebelum logout.' : undefined} /> : undefined;
  if (model.request?.callId && activeCall) return <QueueCallScreen request={model.request} socket={model.socket} status={model.status} role={role} notes={notes} setNotes={setCallNotes} offset={model.serverOffset} officerSettings={settings} />;
  if (model.request?.callId && model.request.status === 'completed' && model.request.callStartedAt) return <FinishedCall request={model.request} role={role} model={model} notes={notes} setNotes={setCallNotes} />;
  if (model.request?.callId && ['completed', 'failed', 'expired'].includes(model.request.status)) return <QueueCallResult request={model.request} role={role} notes={notes} setNotes={setNotes} onDone={model.dismiss} />;
  return role === 'petugas' ? <Dashboard name={model.officerName} model={model} settings={settings} /> : <Passenger session={session} model={model} />;
}

export default function Portal() {
  return getRole() === 'petugas' ? <PortalContent /> : <PassengerI18nProvider><PortalContent /></PassengerI18nProvider>;
}
