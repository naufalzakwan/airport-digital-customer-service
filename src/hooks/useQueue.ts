import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { io, Socket } from 'socket.io-client';
import type { QueueRequest, CallRecord, CallDashboard } from '@/types/queue';

type Role = 'petugas' | 'penumpang';
type Status = 'connecting' | 'connected' | 'disconnected';
type Session = { name: string; id: string };
type Response = { ok: boolean; error?: string; code?: string; name?: string; token?: string; sessionId?: string; recovered?: boolean; request?: QueueRequest | null; requests?: QueueRequest[]; serverNow?: number; call?: CallRecord; dashboard?: CallDashboard };

export function useQueue(session: Session | null, role: Role | 'unsupported', officerCode: MutableRefObject<string>) {
  const tokenKey = `echo-queue-token-${role}`;
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<Status>('disconnected');
  const [queue, setQueue] = useState<QueueRequest[]>([]);
  const [request, setRequest] = useState<QueueRequest | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [connectionError, setConnectionError] = useState('');
  const [officerName, setOfficerName] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!session || role === 'unsupported') {
      setStatus('disconnected');
      setQueue([]);
      setRequest(null);
      setServerOffset(0);
      setConnectionError('');
      setOfficerName('');
      setAuthError('');
      return;
    }
    let disposed = false;
    const getToken = () => { try { return sessionStorage.getItem(tokenKey) || undefined; } catch { return undefined; } };
    const socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, { query: { userId: session.id }, autoConnect: false, forceNew: true });
    socketRef.current = socket;
    setStatus('connecting');
    const authExpired = () => {
      officerCode.current = '';
      setOfficerName('');
      setAuthError('Sesi petugas sudah berakhir. Masuk kembali.');
    };
    const connected = () => {
      setStatus('connecting');
      const token = getToken();
      const socketId = socket.id;
      socket.timeout(5000).emit('queue:register', { role, name: session.name, token, ...(role === 'petugas' && officerCode.current ? { accessCode: officerCode.current } : {}) }, (error: Error | null, result?: Response) => {
        if (disposed || socket.id !== socketId || !socket.connected) return;
        if (error || !result?.ok || !result.token) {
          const message = result?.error || 'Gagal mendaftarkan sesi antrean. Coba lagi.';
          setStatus('disconnected');
          setConnectionError(message);
          if (role === 'petugas' && (!token || result?.code === 'OFFICER_AUTH' || (!error && !result?.ok))) {
            officerCode.current = '';
            setOfficerName('');
            setAuthError(message);
          }
          return;
        }
        if (role === 'petugas') { officerCode.current = ''; setOfficerName(result.name || ''); }
        try { sessionStorage.setItem(tokenKey, result.token); } catch { /* Session cannot survive a page refresh without storage. */ }
        setRequest(result.request || null);
        setQueue(result.requests || []);
        if (result.serverNow) setServerOffset(result.serverNow - Date.now());
        setConnectionError(token && !result.recovered ? 'Sesi antrean sebelumnya sudah berakhir atau server dimulai ulang.' : '');
        setStatus('connected');
      });
    };
    const disconnected = () => { setStatus('disconnected'); setQueue([]); };
    const reconnecting = () => setStatus('connecting');
    const snapshot = (data: { requests: QueueRequest[]; serverNow: number }) => { setQueue(data.requests); setServerOffset(data.serverNow - Date.now()); };
    const state = (data: { request: QueueRequest; serverNow: number }) => { setRequest(data.request); setServerOffset(data.serverNow - Date.now()); };
    socket.on('connect', connected); socket.on('disconnect', disconnected); socket.on('connect_error', disconnected);
    socket.on('queue:auth-expired', authExpired);
    socket.on('queue:snapshot', snapshot); socket.on('queue:state', state); socket.io.on('reconnect_attempt', reconnecting);
    socket.connect();
    return () => { disposed = true; socket.off('connect', connected); socket.off('disconnect', disconnected); socket.off('connect_error', disconnected); socket.off('queue:auth-expired', authExpired); socket.off('queue:snapshot', snapshot); socket.off('queue:state', state); socket.io.off('reconnect_attempt', reconnecting); socket.disconnect(); socketRef.current = null; };
  }, [session, role, tokenKey, officerCode]);

  const send = useCallback((event: string, payload: object): Promise<Response> => new Promise((resolve, reject) => {
    const socket = socketRef.current;
    if (!socket?.connected || status !== 'connected') return reject(new Error('Koneksi server terputus. Hubungkan kembali lalu coba lagi.'));
    socket.timeout(5000).emit(event, payload, (error: Error | null, result?: Response) => {
      if (socketRef.current !== socket) return reject(new Error('Sesi sebelumnya sudah berakhir.'));
      if (error || !result) return reject(new Error('Server tidak merespons. Periksa koneksi dan coba lagi.'));
      if (!result.ok) return reject(new Error(result.error || 'Permintaan tidak dapat diproses.'));
      if (result.request) setRequest(result.request);
      if (result.serverNow) setServerOffset(result.serverNow - Date.now());
      resolve(result);
    });
  }), [status]);
  const dismiss = useCallback(async () => {
    if (request) await send('queue:dismiss', { requestId: request.requestId });
    setRequest(null);
  }, [request, send]);
  const logoutOfficer = useCallback(async () => {
    if (role !== 'petugas') return;
    await send('queue:logout', {});
    try { sessionStorage.removeItem(tokenKey); } catch { /* Storage is optional. */ }
    socketRef.current?.disconnect();
  }, [role, send, tokenKey]);
  return { status, queue, request, send, dismiss, logoutOfficer, serverOffset, connectionError, authError, officerName, socket: socketRef.current };
}
