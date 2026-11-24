import { useState, useRef, useEffect } from 'react';
import { appName, AppBrandMark } from '@/components/AppBrand';
import { io, Socket } from 'socket.io-client';
import { User, SignalData } from '@/types/webrtc';
import { useWebRTC } from '@/hooks/useWebRTC';
import VideoDisplay from '@/components/VideoDisplay';
import CallControls from '@/components/CallControls';
import UserList from '@/components/UserList';
import ConnectionDialog from '@/components/ConnectionDialog';
import StatusIndicator from '@/components/StatusIndicator';
import { toast } from 'sonner';

const Index = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [showConnectionDialog, setShowConnectionDialog] = useState(true);
  const [incomingOffer, setIncomingOffer] = useState<{offer: RTCSessionDescriptionInit, from: string} | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const {
    callState,
    isPTTActive,
    isAudioMuted,
    makeCall,
    answerCall,
    handleHangup,
    handlePTTStart,
    handlePTTEnd,
    handleSignal,
  } = useWebRTC({
    localVideoRef,
    remoteVideoRef,
    socket,
    remoteUserId: selectedUserId,
  });

  // Socket listeners live for the socket's lifetime, but must use current call state.
  const callHandlersRef = useRef({ handleSignal, handleHangup });
  callHandlersRef.current = { handleSignal, handleHangup };

  const handleConnect = (userId: string) => {
    if (!userId || userId.trim() === '') {
      toast.error('Please enter a valid User ID');
      return;
    }

    if (socketRef.current && (socketRef.current.connected || socketRef.current.active)) return;

    socketRef.current?.removeAllListeners();
    socketRef.current?.io.removeAllListeners();
    socketRef.current?.disconnect();
    setDisplayName(userId);
    setConnectionStatus('connecting');

    // Connect to signaling server (configured via .env)
    const serverUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    console.log('Connecting to signaling server:', serverUrl);

    const newSocket = io(serverUrl, {
      query: { mode: 'legacy', userId },
      autoConnect: false,
    });
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      setMyId(newSocket.id || '');
      console.log('Connected to signaling server');
      setConnectionStatus('connected');
      setShowConnectionDialog(false);
      toast.success('Connected to server');
    });

    newSocket.on('disconnect', () => {
      callHandlersRef.current.handleHangup(false);
      setIncomingOffer(null);
      console.log('Disconnected from signaling server');
      setConnectionStatus('disconnected');
      setUsers([]);
      toast.error('Disconnected from server');
    });

    newSocket.on('connect_error', error => {
      setConnectionStatus('disconnected');
      toast.error(error.message);
    });
    newSocket.io.on('reconnect_attempt', () => {
      setConnectionStatus('connecting');
    });

    newSocket.on('users', (userList: User[]) => {
      console.log('Updated user list:', userList);
      setUsers(userList);
    });

    newSocket.on('signal', (data: SignalData) => {
      console.log('Received signal:', data.type);
      callHandlersRef.current.handleSignal(data);

      if (data.type === 'offer' && data.offer) {
        setSelectedUserId(data.from);
        // Store the incoming offer for when user clicks Answer
        setIncomingOffer({ offer: data.offer, from: data.from });
      }
    });

    newSocket.on('hangup', () => {
      console.log('Remote user hung up');
      callHandlersRef.current.handleHangup(false);
      setIncomingOffer(null); // Clear any stored offer
    });

    newSocket.on('error', (error: string) => {
      console.error('Socket error:', error);
      toast.error(error);
    });

    setSocket(newSocket);
    newSocket.connect();
  };

  const handleCloseDialog = () => {
    // Allow closing the dialog anytime
    setShowConnectionDialog(false);
  };

  const handleCall = () => {
    if (!selectedUserId) {
      toast.error('Please select a user to call');
      return;
    }
    makeCall();
  };

  const handleAnswer = () => {
    // Use the stored incoming offer
    if (incomingOffer) {
      answerCall(incomingOffer.offer, incomingOffer.from);
      setIncomingOffer(null); // Clear after answering
    } else {
      toast.error('No incoming call to answer');
    }
  };

  useEffect(() => {
    return () => {
      const currentSocket = socketRef.current;
      if (currentSocket) {
        currentSocket.removeAllListeners();
        currentSocket.io.removeAllListeners();
        currentSocket.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background p-6">
      <ConnectionDialog
        open={showConnectionDialog}
        onConnect={handleConnect}
        onClose={handleCloseDialog}
      />

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <AppBrandMark className="h-10 w-10 shrink-0 sm:h-12 sm:w-12" />
            <div>
              <h1 className="text-xl font-bold text-foreground sm:text-3xl" lang="en">{appName}</h1>
              <p className="text-muted-foreground mt-1">1:1 WebRTC Video Calling</p>
            </div>
          </div>
          <StatusIndicator callState={callState} connectionStatus={connectionStatus} />
        </div>

        {/* Main content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <UserList
              users={users}
              currentUserId={myId}
              selectedUserId={selectedUserId}
              onSelectUser={setSelectedUserId}
              disabled={callState !== 'idle'}
            />
          </div>

          {/* Video area */}
          <div className="lg:col-span-3 space-y-6">
            {/* Video grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Remote video - larger */}
              <div className="md:col-span-2 aspect-video">
                <VideoDisplay
                  ref={remoteVideoRef}
                  userName={users.find(user => user.id === selectedUserId)?.name}
                  isConnected={callState === 'connected'}
                />
              </div>

              {/* Local video - smaller */}
              <div className="aspect-video">
                <VideoDisplay
                  ref={localVideoRef}
                  isLocal
                  userName={displayName}
                  isConnected={callState !== 'idle'}
                />
              </div>
            </div>

            {/* Call controls */}
            <div className="flex justify-center">
              <CallControls
                callState={callState}
                isPTTActive={isPTTActive}
                isAudioMuted={isAudioMuted}
                onCall={handleCall}
                onAnswer={handleAnswer}
                onHangup={handleHangup}
                onPTTStart={handlePTTStart}
                onPTTEnd={handlePTTEnd}
              />
            </div>

            {/* Instructions */}
            {callState === 'idle' && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-semibold text-foreground mb-3">How to use:</h3>
                <ol className="space-y-2 text-sm text-muted-foreground">
                  <li>1. Select a user from the online users list</li>
                  <li>2. Click "Call" to initiate a video call</li>
                  <li>3. During the call, hold "Hold to Speak" button to unmute your microphone (Push-to-Talk)</li>
                  <li>4. Click "Hang Up" to end the call</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
