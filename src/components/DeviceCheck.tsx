import { appName, AppBrandMark } from '@/components/AppBrand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mic, Signal, Video } from 'lucide-react';
import type { ConnectionStatus } from '@/pages/Portal';
import { usePassengerI18n, type TranslationKey } from '@/lib/passengerI18n';

type DeviceStatus = 'unchecked' | 'checking' | 'ready' | 'unavailable';

const errorMessage = (error: unknown): TranslationKey => {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permissionError';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'notFoundError';
  if (name === 'NotReadableError' || name === 'AbortError') return 'deviceBusyError';
  return 'deviceError';
};

export default function DeviceCheck({ status, notice, onBack, onPrepare }: {
  status: ConnectionStatus;
  notice?: string;
  onBack: () => void;
  onPrepare: () => Promise<void>;
}) {
  const { t } = usePassengerI18n()!;
  const [camera, setCamera] = useState<DeviceStatus>('unchecked');
  const [microphone, setMicrophone] = useState<DeviceStatus>('unchecked');
  const [error, setError] = useState<TranslationKey | ''>('');
  const [sending, setSending] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);

  const release = useCallback(() => {
    generationRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  }, []);

  useEffect(() => {
    const onPageHide = () => { release(); setCamera('unchecked'); setMicrophone('unchecked'); setError('deviceStopped'); };
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); release(); };
  }, [release]);

  const checkDevices = async () => {
    if (pendingRef.current) return;
    release();
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable'); setMicrophone('unavailable');
      setError('secureError');
      return;
    }
    pendingRef.current = true;
    const generation = generationRef.current;
    setCamera('checking'); setMicrophone('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      // The user may have left while the browser permission prompt was open.
      if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      stream.getAudioTracks().forEach(track => { track.enabled = false; });
      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks().find(track => track.readyState === 'live');
      const audioTrack = stream.getAudioTracks().find(track => track.readyState === 'live');
      if (!videoTrack || !audioTrack) {
        release();
        setCamera('unavailable'); setMicrophone('unavailable');
        setError('notFoundError');
        return;
      }
      setCamera(videoTrack ? 'ready' : 'unavailable');
      setMicrophone(audioTrack ? 'ready' : 'unavailable');
      if (videoTrack) videoTrack.onended = () => { setCamera('unavailable'); setError('cameraLost'); };
      if (audioTrack) audioTrack.onended = () => { setMicrophone('unavailable'); setError('microphoneLost'); };
    } catch (cause) {
      if (generation === generationRef.current) { setCamera('unavailable'); setMicrophone('unavailable'); setError(errorMessage(cause)); }
    } finally { pendingRef.current = false; }
  };

  const label = (value: DeviceStatus) => t(value);
  const ready = camera === 'ready' && microphone === 'ready' && status === 'connected';
  return <div className="portal-page device-page">
    <header className="device-header"><AppBrandMark /><div><h1 lang="en">{appName}</h1><p>{t('serviceTitle')}</p></div></header>
    <main className="device-main"><h2>{t('deviceIntro')}</h2>
      <div className="device-status-strip" aria-label={t('connection')}>
        <div className="device-status"><span className={`device-status-icon ${camera === 'ready' ? 'ready' : ''}`}><Video aria-hidden="true" /></span><div><strong>{t('camera')}</strong><span>{label(camera)}</span></div></div>
        <div className="device-status"><span className={`device-status-icon ${microphone === 'ready' ? 'ready' : ''}`}><Mic aria-hidden="true" /></span><div><strong>{t('microphone')}</strong><span>{microphone === 'ready' ? `${t('ready')} · ${t('muted')}` : label(microphone)}</span></div></div>
        <div className="device-status"><span className={`device-status-icon ${status === 'connected' ? 'ready' : ''}`}><Signal aria-hidden="true" /></span><div><strong>{t('connection')}</strong><span>{t(status === 'connected' ? 'ready' : status === 'connecting' ? 'connecting' : 'disconnected')}</span></div></div>
      </div>
      <p className="device-mute-note">{t('deviceNote')}</p>
      {notice && <p className="queue-message" role="status">{t('sessionError')}</p>}
      {error && <p className="device-error" role="alert">{t(error)}</p>}
      <button type="button" className="device-check-button" onClick={checkDevices} disabled={camera === 'checking' || microphone === 'checking'}>{t(camera === 'checking' ? 'checking' : camera === 'ready' && microphone === 'ready' ? 'recheck' : 'checkDevices')}</button>
      <button type="button" className="device-call-button call-control-no-select" onContextMenu={event => event.preventDefault()} disabled={!ready || sending} onClick={async () => { setSending(true); setError(''); try { await onPrepare(); } catch { setError('genericError'); } finally { setSending(false); } }}>{t(sending ? 'sending' : 'contact')}</button>
      <p className="device-hint">{t('deviceHint')}</p>
      <button type="button" className="device-back" disabled={sending} onClick={onBack}><ArrowLeft aria-hidden="true" /> {t('back')}</button>
    </main>
  </div>;
}
