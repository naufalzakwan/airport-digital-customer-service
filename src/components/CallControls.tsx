import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CallControlsProps } from '@/types/webrtc';
import { useCallback, useEffect, useRef } from 'react';

const CallControls = ({
  callState,
  isPTTActive,
  isAudioMuted,
  onCall,
  onAnswer,
  onHangup,
  onPTTStart,
  onPTTEnd,
  labels,
}: CallControlsProps) => {
  const activePointer = useRef<number | null>(null);
  const stopSpeaking = useCallback(() => {
    if (activePointer.current === null) return;
    activePointer.current = null;
    onPTTEnd();
  }, [onPTTEnd]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') stopSpeaking();
    };
    window.addEventListener('blur', stopSpeaking);
    window.addEventListener('pagehide', stopSpeaking);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', stopSpeaking);
      window.removeEventListener('pagehide', stopSpeaking);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopSpeaking();
    };
  }, [stopSpeaking]);

  useEffect(() => {
    if (callState !== 'connected') stopSpeaking();
  }, [callState, stopSpeaking]);

  return (
    <div className="flex items-center justify-center gap-4">
      {/* Call/Answer button */}
      {callState === 'idle' && (
        <Button
          size="lg"
          onClick={onCall}
          className="bg-success hover:bg-success/90 text-success-foreground h-14 px-8 rounded-full shadow-lg transition-all hover:scale-105"
        >
          <Phone className="w-5 h-5 mr-2" />
          Call
        </Button>
      )}

      {callState === 'incoming' && (
        <Button
          size="lg"
          onClick={onAnswer}
          className="bg-success hover:bg-success/90 text-success-foreground h-14 px-8 rounded-full shadow-lg transition-all hover:scale-105"
        >
          <Phone className="w-5 h-5 mr-2" />
          Answer
        </Button>
      )}

      {/* PTT button - only show when connected */}
      {callState === 'connected' && (
        <Button
          size="lg"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || activePointer.current !== null) return;
            activePointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            onPTTStart();
          }}
          onPointerMove={(event) => {
            if (activePointer.current !== event.pointerId) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) stopSpeaking();
          }}
          onPointerUp={(event) => { if (activePointer.current === event.pointerId) stopSpeaking(); }}
          onPointerCancel={(event) => { if (activePointer.current === event.pointerId) stopSpeaking(); }}
          onLostPointerCapture={(event) => { if (activePointer.current === event.pointerId) stopSpeaking(); }}
          onContextMenu={(event) => event.preventDefault()}
          className={`call-control-no-select touch-none h-14 px-8 rounded-full shadow-lg transition-all ${
            isPTTActive
              ? 'bg-success hover:bg-success/90 text-success-foreground scale-110'
              : 'bg-control-bg hover:bg-control-hover text-foreground'
          }`}
        >
          {isPTTActive ? (
            <Mic className="w-5 h-5 mr-2" />
          ) : (
            <MicOff className="w-5 h-5 mr-2" />
          )}
          {isPTTActive ? labels?.speaking || 'Speaking...' : labels?.hold || 'Hold to Speak'}
        </Button>
      )}

      {/* Hangup button */}
      {(callState === 'calling' || callState === 'incoming' || callState === 'connected' || callState === 'reconnecting') && (
        <Button
          size="lg"
          onClick={onHangup}
          onContextMenu={(event) => event.preventDefault()}
          className="call-control-no-select bg-destructive hover:bg-destructive/90 text-destructive-foreground h-14 px-8 rounded-full shadow-lg transition-all hover:scale-105"
        >
          <PhoneOff className="w-5 h-5 mr-2" />
          {labels?.hangUp || 'Hang Up'}
        </Button>
      )}
    </div>
  );
};

export default CallControls;
