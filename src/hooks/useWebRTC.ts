import { useState, useRef, useCallback, useEffect } from 'react';
import { CallState, SignalData } from '@/types/webrtc';
import { toast } from 'sonner';
import { describeTrack, logPeerDiagnostics, logVideoStats, webRTCDebugEnabled } from '@/lib/webrtcDiagnostics';

const STUN_SERVER = 'stun:stun.l.google.com:19302';

interface UseWebRTCProps {
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  socket: any;
  remoteUserId: string | null;
}

export const useWebRTC = ({
  localVideoRef,
  remoteVideoRef,
  socket,
  remoteUserId
}: UseWebRTCProps) => {
  const [callState, setCallState] = useState<CallState>('idle');
  const [isPTTActive, setIsPTTActive] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(true);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const inboundIce = useRef<RTCIceCandidateInit[]>([]);
  const attempt = useRef(0);
  const diagnosticsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (diagnosticsTimerRef.current) clearInterval(diagnosticsTimerRef.current);
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
    }
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    remoteStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  // Initialize local media stream
  const initLocalStream = useCallback(async () => {
    if (!window.isSecureContext) {
      throw new Error('Kamera dan mikrofon memerlukan HTTPS yang dipercaya. Buka alamat HTTPS aplikasi dan pasang sertifikat CA lokal.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser tidak menyediakan akses kamera dan mikrofon. Gunakan browser yang mendukungnya dan periksa izin perangkat.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Mute audio by default
      stream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });

      if (webRTCDebugEnabled()) console.debug('[Echo WebRTC] local tracks', stream.getTracks().map(describeTrack));

      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  }, [localVideoRef]);

  // Create peer connection
  const createPeerConnection = useCallback((target: string, outbound?: { ready: boolean; queued: RTCIceCandidateInit[] }) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: STUN_SERVER }],
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate || !socket.connected) return;
      const candidate = event.candidate.toJSON();
      if (outbound && !outbound.ready) {
        if (outbound.queued.length < 128) outbound.queued.push(candidate);
      } else socket.emit('signal', { type: 'ice-candidate', candidate, to: target });
    };

    pc.ontrack = (event) => {
      if (webRTCDebugEnabled()) console.debug('[Echo WebRTC] ontrack', describeTrack(event.track));
      const existingTracks = remoteStreamRef.current?.getTracks() || [];
      if (!existingTracks.includes(event.track)) {
        remoteStreamRef.current = new MediaStream([...existingTracks, event.track]);
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        void remoteVideoRef.current.play().catch(error => {
          // Replacing the stream as the next track arrives can interrupt play().
          if (error instanceof Error && error.name === 'AbortError') return;
          console.warn('Remote media playback failed:', error instanceof Error ? error.name : 'unknown');
          toast.warning('Remote playback was blocked. Tap the remote video to try again.');
        });
      }
      logPeerDiagnostics(pc, 'track received');
    };

    pc.oniceconnectionstatechange = () => logPeerDiagnostics(pc, 'ICE state changed');
    if (webRTCDebugEnabled()) {
      diagnosticsTimerRef.current = setInterval(() => void logVideoStats(pc, remoteVideoRef.current), 5000);
    }

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      logPeerDiagnostics(pc, 'connection state changed');
      if (pc.connectionState === 'connected') {
        setCallState('connected');
        toast.success('Call connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setCallState('reconnecting');
        toast.warning('Connection lost, attempting to reconnect...');
      } else if (pc.connectionState === 'closed') {
        handleHangup();
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [socket, remoteVideoRef]);

  const cleanupMedia = useCallback(() => {
    attempt.current++;
    inboundIce.current = [];
    if (diagnosticsTimerRef.current) {
      clearInterval(diagnosticsTimerRef.current);
      diagnosticsTimerRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => track.stop());
      remoteStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setCallState('idle');
    setIsPTTActive(false);
    setIsAudioMuted(true);

  }, [localVideoRef, remoteVideoRef]);

  const applyRemoteDescription = useCallback(async (pc: RTCPeerConnection, description: RTCSessionDescriptionInit) => {
    await pc.setRemoteDescription(description);
    const queued = inboundIce.current.splice(0);
    for (const candidate of queued) await pc.addIceCandidate(candidate);
  }, []);

  // Make a call
  const makeCall = useCallback(async () => {
    console.log('makeCall - Starting call to:', remoteUserId);

    if (!remoteUserId || !socket?.connected) {
      console.error('makeCall - Error: No user selected or socket not connected');
      toast.error('No user selected');
      return;
    }

    try {
      console.log('makeCall - Setting call state to calling...');
      const generation = ++attempt.current;
      setCallState('calling');

      console.log('makeCall - Step 1: Initializing local stream...');
      const stream = await initLocalStream();
      if (generation !== attempt.current || !socket?.connected) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      console.log('makeCall - Step 1: ✅ Local stream initialized, tracks:', stream.getTracks().length);

      console.log('makeCall - Step 2: Creating peer connection...');
      const outbound = { ready: false, queued: [] as RTCIceCandidateInit[] };
      const pc = createPeerConnection(remoteUserId, outbound);
      console.log('makeCall - Step 2: ✅ Peer connection created');

      // Add local tracks to peer connection
      console.log('makeCall - Step 3: Adding local tracks...');
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      logPeerDiagnostics(pc, 'caller tracks added');
      console.log('makeCall - Step 3: ✅ All tracks added');

      // Create and send offer
      console.log('makeCall - Step 4: Creating offer...');
      const offer = await pc.createOffer();
      console.log('makeCall - Step 4: ✅ Offer created');

      console.log('makeCall - Step 5: Setting local description...');
      await pc.setLocalDescription(offer);
      console.log('makeCall - Step 5: ✅ Local description set');

      console.log('makeCall - Step 6: Sending offer via socket...');
      if (generation !== attempt.current) return;
      const result = await socket.timeout(5000).emitWithAck('signal', { type: 'offer', offer, to: remoteUserId });
      if (generation !== attempt.current) return;
      if (!result?.ok) throw new Error(result?.error || 'Legacy signaling unavailable.');
      outbound.ready = true;
      for (const candidate of outbound.queued) socket.emit('signal', { type: 'ice-candidate', candidate, to: remoteUserId });
      console.log('makeCall - Step 6: ✅ Offer sent');
      console.log('makeCall - ✅ Call initiated successfully!');

      toast.info('Calling...');
    } catch (error: any) {
      console.error('❌ makeCall - Error:', error);
      console.error('❌ makeCall - Error name:', error?.name);
      console.error('❌ makeCall - Error message:', error?.message);

      // Specific error messages
      if (error?.name === 'NotAllowedError') {
        toast.error('Camera/Microphone permission denied. Please allow access.');
      } else if (error?.name === 'NotFoundError') {
        toast.error('Camera or microphone not found on this device.');
      } else if (error?.name === 'NotReadableError') {
        toast.error('Camera or microphone is already in use.');
      } else {
        toast.error(`Failed to initiate call: ${error?.message || 'Unknown error'}`);
      }

      cleanupMedia();
    }
  }, [remoteUserId, socket, initLocalStream, createPeerConnection, cleanupMedia]);

  // Answer a call
  const answerCall = useCallback(async (offer: RTCSessionDescriptionInit, from: string) => {
    const generation = ++attempt.current;
    console.log('answerCall - Starting to answer call from:', from);

    try {
      console.log('answerCall - Step 1: Initializing local stream...');
      const stream = await initLocalStream();
      if (generation !== attempt.current || !socket?.connected) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      console.log('answerCall - Step 1: ✅ Local stream initialized, tracks:', stream.getTracks().length);

      console.log('answerCall - Step 2: Creating peer connection...');
      const pc = createPeerConnection(from);
      console.log('answerCall - Step 2: ✅ Peer connection created');

      // Apply the offer first so addTrack can reuse its corresponding transceivers.
      await applyRemoteDescription(pc, offer);

      // Add local tracks to peer connection
      console.log('answerCall - Step 3: Adding local tracks to peer connection...');
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      logPeerDiagnostics(pc, 'answerer tracks added');
      console.log('answerCall - Step 3: ✅ All tracks added');

      console.log('answerCall - Step 5: Creating answer...');
      const answer = await pc.createAnswer();
      console.log('answerCall - Step 5: ✅ Answer created');

      console.log('answerCall - Step 6: Setting local description...');
      await pc.setLocalDescription(answer);
      logPeerDiagnostics(pc, 'answer applied');
      console.log('answerCall - Step 6: ✅ Local description set');

      console.log('answerCall - Step 7: Sending answer via socket...');
      if (!socket) {
        throw new Error('Socket not connected');
      }

      if (generation !== attempt.current) return;
      const result = await socket.timeout(5000).emitWithAck('signal', { type: 'answer', answer, to: from });
      if (generation !== attempt.current) return;
      if (!result?.ok) throw new Error(result?.error || 'Legacy signaling unavailable.');
      console.log('answerCall - Step 7: ✅ Answer sent');

      console.log('answerCall - Step 8: Setting call state to connected...');
      setCallState('connected');
      console.log('answerCall - ✅ Call answered successfully!');
      toast.success('Call answered');
    } catch (error: any) {
      console.error('❌ answerCall - Error:', error);
      console.error('❌ answerCall - Error name:', error?.name);
      console.error('❌ answerCall - Error message:', error?.message);
      console.error('❌ answerCall - Error stack:', error?.stack);

      // Specific error messages
      if (error?.name === 'NotAllowedError') {
        toast.error('Camera/Microphone permission denied. Please allow access.');
      } else if (error?.name === 'NotFoundError') {
        toast.error('Camera or microphone not found on this device.');
      } else if (error?.name === 'NotReadableError') {
        toast.error('Camera or microphone is already in use by another application.');
      } else {
        toast.error(`Failed to answer call: ${error?.message || 'Unknown error'}`);
      }

      cleanupMedia();
    }
  }, [socket, initLocalStream, createPeerConnection, applyRemoteDescription, cleanupMedia]);

  // Handle incoming signal
  const handleSignal = useCallback(async (data: SignalData) => {
    const pc = peerConnectionRef.current;

    try {
      if (data.type === 'offer') {
        setCallState('incoming');
      } else if (data.type === 'answer' && pc) {
        await applyRemoteDescription(pc, data.answer!);
        logPeerDiagnostics(pc, 'answer received');
        setCallState('connected'); // Update state when answer is received
        toast.success('Call connected');
      } else if (data.type === 'ice-candidate' && data.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate);
        else if (inboundIce.current.length < 128) inboundIce.current.push(data.candidate);
      }
    } catch (error) {
      console.error('Error handling signal:', error);
    }
  }, [applyRemoteDescription]);

  const handleHangup = useCallback((notifyRemote = true) => {
    cleanupMedia();
    if (notifyRemote && socket?.connected && remoteUserId) socket.emit('hangup', { to: remoteUserId });
  }, [socket, remoteUserId, cleanupMedia]);

  // Push-to-talk controls
  const handlePTTStart = useCallback(() => {
    console.log('PTT Start - callState:', callState, 'hasStream:', !!localStreamRef.current);
    if (localStreamRef.current && callState === 'connected') {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = true;
      });
      setIsPTTActive(true);
      setIsAudioMuted(false);
      toast.info('Microphone activated');
    } else {
      console.warn('Cannot start PTT - callState:', callState, 'hasStream:', !!localStreamRef.current);
    }
  }, [callState]);

  const handlePTTEnd = useCallback(() => {
    console.log('PTT End');
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      console.log('Disabling audio tracks:', audioTracks.length);
      audioTracks.forEach(track => {
        track.enabled = false;
      });
      setIsPTTActive(false);
      setIsAudioMuted(true);
      toast.info('Microphone muted');
    }
  }, []);

  return {
    callState,
    isPTTActive,
    isAudioMuted,
    makeCall,
    answerCall,
    handleHangup,
    handlePTTStart,
    handlePTTEnd,
    handleSignal,
  };
};
