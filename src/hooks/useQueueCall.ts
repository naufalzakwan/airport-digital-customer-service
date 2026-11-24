import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { collectVideoDiagnostics, logPeerDiagnostics, webRTCDebugEnabled } from '@/lib/webrtcDiagnostics';
import type { ConnectionStatus } from '@/pages/Portal';
import { usePassengerI18n } from '@/lib/passengerI18n';

type Phase = 'preparing' | 'connecting' | 'connected' | 'reconnecting' | 'ending';
type Signal = { callId: string; generation: number; type: 'offer' | 'answer' | 'ice-candidate'; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

// Queue calls use callId-scoped signaling; /legacy keeps its existing WebRTC hook.
export function useQueueCall(socket: Socket | null, status: ConnectionStatus, callId: string, generation: number, role: 'petugas' | 'penumpang', peerOnline: boolean) {
  const i18n = usePassengerI18n();
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const mediaLock = useRef<Promise<void>>(Promise.resolve());
  const peer = useRef<RTCPeerConnection | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const pendingEnd = useRef<{ reason: 'hangup' | 'failed'; failureCode?: string } | null>(null);
  const endInFlight = useRef(false);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [speaking, setSpeaking] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<'permissionError' | 'notFoundError' | 'callError' | 'retryEnd'>('callError');
  const [retryEpoch, setRetryEpoch] = useState(0);
  const [diagnostics, setDiagnostics] = useState<(Awaited<ReturnType<typeof collectVideoDiagnostics>> & { comparison: object }) | null>(null);

  const sendEnd = useCallback(() => {
    if (!pendingEnd.current || !socket?.connected || status !== 'connected' || endInFlight.current) return;
    endInFlight.current = true;
    socket.timeout(5000).emit('call:end', { callId, generation, ...pendingEnd.current }, (err: Error | null, result?: { ok: boolean; error?: string; code?: string }) => {
      endInFlight.current = false;
      if (result?.code === 'STALE_GENERATION') { pendingEnd.current = null; setError(''); setPhase('reconnecting'); setRetryEpoch(value => value + 1); return; }
      if (err || !result?.ok) { setErrorKind('retryEnd'); setError('Gagal mengirim akhir panggilan. Coba lagi saat koneksi kembali.'); return; }
      pendingEnd.current = null;
    });
  }, [callId, generation, socket, status]);
  const end = useCallback((reason: 'hangup' | 'failed' = 'hangup', message = '', failureCode?: string) => {
    if (pendingEnd.current) return;
    pendingEnd.current = { reason, failureCode };
    cleanupRef.current();
    setSpeaking(false);
    setPhase('ending');
    if (message) { setErrorKind(failureCode === 'permission_denied' ? 'permissionError' : failureCode === 'device_unavailable' ? 'notFoundError' : 'callError'); setError(message); }
    sendEnd();
  }, [sendEnd]);
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => { if (status === 'connected') sendEnd(); }, [status, sendEnd]);

  useEffect(() => {
    if (!socket || !callId || pendingEnd.current) return;
    let alive = true;
    const remoteStream = new MediaStream();
    const trackListeners: Array<() => void> = [];
    let pc: RTCPeerConnection | null = null;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    let frameCallback: number | undefined;
    let frameVideo: HTMLVideoElement | null = null;
    let presentedFrames = 0;
    let callbacks = 0;
    const history: Array<{ time: number; decoded: number; presented: number; callbacks: number }> = [];
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const candidates: RTCIceCandidateInit[] = [];
    let chain = Promise.resolve();
    const clean = () => {
      if (!alive) return;
      alive = false;
      if (statsTimer) clearInterval(statsTimer);
      if (frameCallback !== undefined && frameVideo?.cancelVideoFrameCallback) frameVideo.cancelVideoFrameCallback(frameCallback);
      if (disconnectTimer) clearTimeout(disconnectTimer);
      trackListeners.forEach(remove => remove());
      socket.off('call:begin', onBegin);
      socket.off('call:signal', onSignal);
      if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; pc.close(); }
      if (peer.current === pc) peer.current = null;
      localStream.current?.getTracks().forEach(track => track.stop());
      localStream.current = null;
      remoteStream.getTracks().forEach(track => track.stop());
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    cleanupRef.current = clean;
    const fail = (message: string, code = 'connection_failed') => { if (alive) endRef.current('failed', message, code); };
    const emit = (event: string, data: object) => new Promise<void>((resolve, reject) => {
      if (!socket.connected) return reject(new Error('Koneksi signaling terputus.'));
      socket.timeout(8000).emit(event, data, (err: Error | null, response?: { ok: boolean; error?: string; code?: string }) => {
        if (err || !response?.ok) return reject(new Error(response?.code || response?.error || 'Server tidak merespons.'));
        resolve();
      });
    });
    const signal = (data: Omit<Signal, 'callId' | 'generation'>) => emit('call:signal', { callId, generation, ...data });
    const flushCandidates = async () => { while (pc?.remoteDescription && candidates.length && alive) await pc.addIceCandidate(candidates.shift()!); };
    const processSignal = async (data: Signal) => {
      if (!alive || !pc || data.callId !== callId || data.generation !== generation) return;
      if (data.type === 'ice-candidate' && data.candidate) {
        if (!pc.remoteDescription) candidates.push(data.candidate); else await pc.addIceCandidate(data.candidate);
      } else if (data.type === 'offer' && role === 'penumpang' && data.description) {
        await pc.setRemoteDescription(data.description);
        if (!alive || !localStream.current) return;
        // Reuse the transceivers created by the offer, as in the working legacy call.
        localStream.current.getTracks().forEach(track => pc!.addTrack(track, localStream.current!));
        logPeerDiagnostics(pc, 'queue answer tracks attached');
        await flushCandidates();
        const answer = await pc.createAnswer(); if (!alive) return;
        await pc.setLocalDescription(answer); if (!alive) return;
        await signal({ type: 'answer', description: pc.localDescription!.toJSON() });
      } else if (data.type === 'answer' && role === 'petugas' && data.description) {
        await pc.setRemoteDescription(data.description); await flushCandidates();
      }
    };
    const handleSignalError = (cause: unknown, message: string) => {
      if (!alive || !socket.connected || (cause instanceof Error && cause.message === 'STALE_GENERATION')) return;
      if (cause instanceof Error && cause.message === 'PEER_OFFLINE') { setPhase('reconnecting'); return; }
      fail(message);
    };
    const onSignal = (data: Signal) => { chain = chain.then(() => processSignal(data)).catch(cause => handleSignalError(cause, 'Negosiasi media gagal. Silakan coba panggilan lagi.')); };
    const onBegin = (data: { callId: string; generation: number }) => {
      if (!alive || !pc || data.callId !== callId || data.generation !== generation || role !== 'petugas') return;
      chain = chain.then(async () => { if (!pc || !alive) return; const offer = await pc.createOffer(); if (!alive) return; await pc.setLocalDescription(offer); if (!alive) return; await signal({ type: 'offer', description: pc.localDescription!.toJSON() }); }).catch(cause => handleSignalError(cause, 'Gagal memulai negosiasi panggilan.'));
    };
    socket.on('call:signal', onSignal);
    socket.on('call:begin', onBegin);
    setPhase('preparing'); setCameraEnabled(true); setSpeaking(false); setError('');
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Kamera dan mikrofon memerlukan HTTPS yang dipercaya.');
        // A reconnect can supersede an unresolved permission prompt. Never open
        // a second camera stream until the earlier request has finished cleanup.
        const previous = mediaLock.current;
        let unlock!: () => void;
        mediaLock.current = new Promise<void>(resolve => { unlock = resolve; });
        await previous;
        let stream: MediaStream;
        try {
          if (!alive) return;
          stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          if (!alive) { stream.getTracks().forEach(track => track.stop()); return; }
          stream.getAudioTracks().forEach(track => { track.enabled = false; });
        } finally { unlock(); }
        if (!stream.getAudioTracks().length || !stream.getVideoTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error('Kamera atau mikrofon tidak tersedia.'); }
        localStream.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); peer.current = pc;
        if (role === 'petugas') stream.getTracks().forEach(track => pc!.addTrack(track, stream));
        pc.onicecandidate = event => { if (event.candidate && alive) void signal({ type: 'ice-candidate', candidate: event.candidate.toJSON() }).catch(cause => handleSignalError(cause, 'Gagal mengirim kandidat koneksi.')); };
        pc.ontrack = event => {
          if (!alive) return;
          if (!remoteStream.getTracks().includes(event.track)) remoteStream.addTrack(event.track);
          const video = remoteVideoRef.current;
          const play = () => { if (alive && video) void video.play().catch(err => { if (alive && err?.name !== 'AbortError') toast.warning(i18nRef.current?.t('playbackBlocked') || 'Pemutaran diblokir. Ketuk video untuk mencoba lagi.'); }); };
          if (video) { if (video.srcObject !== remoteStream) video.srcObject = remoteStream; play(); }
          event.track.addEventListener('unmute', play);
          trackListeners.push(() => event.track.removeEventListener('unmute', play));
          logPeerDiagnostics(pc!, 'queue remote track');
        };
        pc.onconnectionstatechange = () => {
          if (!alive || !pc) return;
          logPeerDiagnostics(pc, 'queue call state');
          if (pc.connectionState === 'connected') { if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = undefined; } setPhase('connected'); void emit('call:connected', { callId, generation }).catch(cause => handleSignalError(cause, 'Gagal menyinkronkan status panggilan.')); }
          else if (pc.connectionState === 'failed') fail('Koneksi video gagal. Silakan coba lagi.');
          else if (pc.connectionState === 'disconnected') { stream.getAudioTracks().forEach(track => { track.enabled = false; }); setSpeaking(false); setPhase('reconnecting'); if (!disconnectTimer) disconnectTimer = setTimeout(() => fail('Koneksi video terputus terlalu lama.'), 30000); }
        };
        if (webRTCDebugEnabled()) {
          frameVideo = remoteVideoRef.current;
          if (frameVideo?.requestVideoFrameCallback) {
            const onFrame: VideoFrameRequestCallback = (_time, metadata) => { if (!alive || !frameVideo) return; callbacks++; presentedFrames = metadata.presentedFrames; frameCallback = frameVideo.requestVideoFrameCallback(onFrame); };
            frameCallback = frameVideo.requestVideoFrameCallback(onFrame);
          }
          const updateStats = () => { if (pc && alive) void collectVideoDiagnostics(pc, remoteVideoRef.current, localStream.current).then(snapshot => {
            if (!alive) return;
            const time = Date.now();
            history.push({ time, decoded: snapshot.decodedFrames, presented: presentedFrames, callbacks });
            while (history.length > 1 && time - history[1].time >= 10000) history.shift();
            const base = history[0];
            const comparison = { generation, sameElementSinceStart: frameVideo === remoteVideoRef.current, frameCallbackSupported: !!frameVideo?.requestVideoFrameCallback, intervalSeconds: (time - base.time) / 1000, decodedDelta: snapshot.decodedFrames - base.decoded, presentedDelta: frameVideo?.requestVideoFrameCallback ? presentedFrames - base.presented : null, callbackDelta: frameVideo?.requestVideoFrameCallback ? callbacks - base.callbacks : null };
            setDiagnostics({ ...snapshot, comparison });
          }).catch(() => {}); };
          updateStats();
          statsTimer = setInterval(updateStats, 2000);
        }
        setPhase('connecting');
        await emit('call:ready', { callId, generation });
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : '';
        if (!socket.connected || (cause instanceof Error && cause.message === 'STALE_GENERATION')) { if (alive) setPhase('reconnecting'); return; }
        fail(name === 'NotAllowedError' ? 'Izin kamera atau mikrofon ditolak. Izinkan akses dan coba lagi.' : cause instanceof Error ? cause.message : 'Gagal mengakses perangkat.', name === 'NotAllowedError' || name === 'SecurityError' ? 'permission_denied' : name === 'NotFoundError' || name === 'NotReadableError' ? 'device_unavailable' : 'connection_failed');
      }
    };
    void start();
    return clean;
  }, [socket, callId, generation, role, retryEpoch]);

  useEffect(() => {
    if (status !== 'connected' || !peerOnline) {
      localStream.current?.getAudioTracks().forEach(track => { track.enabled = false; });
      setSpeaking(false);
      setPhase(current => current === 'ending' ? current : 'reconnecting');
    }
  }, [status, peerOnline]);

  const startSpeaking = useCallback(() => { if (phase !== 'connected' || status !== 'connected' || !peerOnline) return; localStream.current?.getAudioTracks().forEach(track => { track.enabled = true; }); setSpeaking(true); }, [phase, status, peerOnline]);
  const stopSpeaking = useCallback(() => { localStream.current?.getAudioTracks().forEach(track => { track.enabled = false; }); setSpeaking(false); }, []);
  const toggleCamera = useCallback(() => { const track = localStream.current?.getVideoTracks()[0]; if (track) { track.enabled = !track.enabled; setCameraEnabled(track.enabled); } }, []);
  return { localVideoRef, remoteVideoRef, phase, speaking, cameraEnabled, error, errorKind, diagnostics, startSpeaking, stopSpeaking, toggleCamera, hangup: () => { if (pendingEnd.current) sendEnd(); else end(); } };
}
