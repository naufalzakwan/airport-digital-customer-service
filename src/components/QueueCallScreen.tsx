import { appName, AppBrandMark } from '@/components/AppBrand';
import { useEffect, useState, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { Video, VideoOff } from 'lucide-react';
import { useQueueCall } from '@/hooks/useQueueCall';
import CallControls from '@/components/CallControls';
import VideoDisplay from '@/components/VideoDisplay';
import type { QueueRequest } from '@/types/queue';
import type { ConnectionStatus } from '@/pages/Portal';
import { categoryLabel, usePassengerI18n } from '@/lib/passengerI18n';

const categories = ['Flight Information', 'Lost & Found', 'General Assistance', 'Accessibility Services'];

export function QueueCallScreen({ request, socket, status, role, notes, setNotes, offset, officerSettings }: { request: QueueRequest; socket: Socket | null; status: ConnectionStatus; role: 'petugas' | 'penumpang'; notes: string; setNotes: (value: string) => void; offset: number; officerSettings?: ReactNode }) {
  const t = usePassengerI18n()?.t;
  const peerOnline = role === 'petugas' ? request.passengerOnline : request.officerOnline;
  const call = useQueueCall(socket, status, request.callId!, request.callGeneration, role, peerOnline);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = request.callStartedAt ? Math.max(0, Math.floor((now + offset - request.callStartedAt) / 1000)) : 0;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const reconnecting = status !== 'connected' || !peerOnline || call.phase === 'reconnecting';
  const label = t ? t(call.phase === 'ending' ? 'ending' : reconnecting ? 'reconnecting' : call.phase === 'connected' ? 'connected' : 'preparing') : call.phase === 'ending' ? 'Mengakhiri panggilan...' : reconnecting ? 'Menghubungkan kembali...' : call.phase === 'connected' ? 'Terhubung' : 'Mempersiapkan panggilan...';
  const peerName = role === 'petugas' ? request.passengerName : request.officerName || t?.('officer') || 'Petugas';
  const videoLabels = t ? { you: t('you'), live: t('live') } : undefined;
  return <div className="portal-page call-page"><header className="call-header"><div className="call-brand"><AppBrandMark /><div><h1 lang="en">{appName}</h1><p>{t ? t('serviceTitle') : 'LAYANAN PELANGGAN DIGITAL'}</p></div></div><div className="call-clock" dir="ltr" aria-label={t ? t('duration') : 'Durasi panggilan'}>{duration}</div>{officerSettings}<span className="call-connection" role="status">{label}</span></header>
    <main className={role === 'petugas' ? 'call-layout officer' : 'call-layout'}><div className="call-video-area"><div className="call-video-main"><VideoDisplay ref={call.remoteVideoRef} fit="contain" userName={peerName} labels={videoLabels} isConnected={call.phase === 'connected'} /><div className="call-category"><small>{t ? t('category') : 'KATEGORI LAYANAN'}</small><strong>{t ? categoryLabel(request.serviceCategory,t) : request.serviceCategory}</strong></div><div className="call-preview"><VideoDisplay ref={call.localVideoRef} isLocal labels={videoLabels} userName={role === 'petugas' ? request.officerName || 'Petugas' : request.passengerName} isConnected={call.phase !== 'ending'} /></div></div><p className="call-peer-name" dir="auto">{peerName}</p></div>
      {role === 'petugas' && <aside className="call-information"><h2>Call Information</h2><p><strong>Penumpang:</strong> {request.passengerName}</p><p><strong>Bahasa:</strong> {request.language}</p><p><strong>ID panggilan:</strong> {request.referenceCode || "—"}</p><div className="call-categories">{categories.map(item => <div key={item} className={item === request.serviceCategory ? 'active' : ''}>{item}</div>)}</div><label htmlFor="call-notes">Call Notes</label><textarea id="call-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} placeholder="Catatan layanan (draft)" /><small>Draft disinkronkan saat terhubung; simpan final setelah panggilan.</small></aside>}
    </main>
    {call.error && <p className="call-error" role="alert">{t ? t(call.errorKind) : call.error}</p>}
    {call.diagnostics && <details style={{ margin: '1rem', padding: '0.75rem', background: '#fff', color: '#111', overflowWrap: 'anywhere' }}><summary>{t ? `WebRTC · ${t('connection')}` : 'Diagnostik WebRTC (debug)'}</summary><pre dir="ltr" style={{ whiteSpace: 'pre-wrap', fontSize: '12px' }}>{JSON.stringify(call.diagnostics, null, 2)}</pre></details>}
    <footer className="call-toolbar"><button className="call-camera call-control-no-select" onContextMenu={event => event.preventDefault()} onClick={call.toggleCamera} disabled={call.phase === 'ending'} aria-pressed={call.cameraEnabled}>{call.cameraEnabled ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}{t ? t(call.cameraEnabled ? 'camera' : 'cameraOff') : call.cameraEnabled ? 'Kamera' : 'Kamera mati'}</button>
      <CallControls labels={t ? { hold: t('hold'), speaking: t('speaking'), hangUp: t('hangUp') } : undefined} callState={!reconnecting && call.phase === 'connected' ? 'connected' : reconnecting ? 'reconnecting' : 'calling'} isPTTActive={call.speaking} isAudioMuted={!call.speaking} onCall={() => {}} onAnswer={() => {}} onHangup={call.hangup} onPTTStart={call.startSpeaking} onPTTEnd={call.stopSpeaking} /></footer>
  </div>;
}

export function QueueCallResult({ request, role, notes, setNotes, onDone }: { request: QueueRequest; role: 'petugas' | 'penumpang'; notes: string; setNotes: (value: string) => void; onDone: () => Promise<unknown> }) {
  const t = usePassengerI18n()?.t;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const finished = request.status === 'completed' && !!request.callStartedAt;
  const duration = request.callStartedAt && request.callEndedAt ? Math.max(0, Math.floor((request.callEndedAt - request.callStartedAt) / 1000)) : 0;
  const failure = request.callFailureCode === 'permission_denied' ? `Izin kamera atau mikrofon ditolak pada perangkat ${request.callFailedRole || 'pengguna'}. Periksa izin browser lalu coba lagi.` : request.callFailureCode === 'device_unavailable' ? `Kamera atau mikrofon pada perangkat ${request.callFailedRole || 'pengguna'} tidak tersedia. Periksa perangkat lalu coba lagi.` : 'Panggilan berakhir sebelum tersambung atau koneksi gagal. Silakan coba lagi.';
  if (t) return <div className="portal-page call-result-page"><header className="device-header"><AppBrandMark /><div><h1 lang="en">{appName}</h1><p>{t('serviceTitle')}</p></div></header><main className="call-result"><div className="call-result-card"><div className="call-result-check">!</div><h1>{t(request.callStartedAt ? 'interrupted' : 'failed')}</h1><p>{t(request.callFailureCode === 'permission_denied' ? 'permissionError' : request.callFailureCode === 'device_unavailable' ? 'notFoundError' : 'preparingError')}</p><p dir="ltr">ID: {request.referenceCode || "—"}</p><p>{t('duration')}: <span dir="ltr">{Math.floor(duration / 60)}:{String(duration % 60).padStart(2,'0')}</span></p>{error && <p role="alert" className="device-error">{t('genericError')}</p>}<button className="portal-primary" disabled={busy} onClick={async()=>{setBusy(true);try{await onDone()}catch{setError('error')}finally{setBusy(false)}}}>{t('mainMenu')}</button></div></main></div>;
  return <div className="portal-page call-result-page"><header className="device-header"><AppBrandMark /><div><h1 lang="en">{appName}</h1><p>Layanan Pelanggan Digital</p></div></header><main className="call-result"><div className="call-result-card"><div className="call-result-check">{finished ? '✓' : '!'}</div><h1>{finished ? 'Panggilan Berakhir' : request.callStartedAt ? 'Panggilan Terputus' : 'Panggilan Tidak Tersambung'}</h1><p>{finished ? 'Terima kasih telah menggunakan layanan pelanggan digital.' : failure}</p><p>ID: {request.referenceCode || "—"}</p><p>Durasi: {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}</p>{role === 'petugas' && <><label htmlFor="review-notes">Catatan layanan · draft sesi</label><textarea id="review-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} /><small>Catatan belum disimpan ke server dan akan hilang jika halaman ditutup.</small></>}{role === 'penumpang' && <small>Rating pelayanan akan tersedia pada tahap berikutnya.</small>}{error && <p role="alert" className="device-error">{error}</p>}<button className="portal-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onDone(); } catch { setError('Tidak dapat menutup status. Periksa koneksi dan coba lagi.'); } finally { setBusy(false); } }}>Kembali ke {role === 'petugas' ? 'Dashboard' : 'Menu'}</button></div></main></div>;
}
