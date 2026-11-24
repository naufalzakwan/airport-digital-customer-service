export interface User {
  id: string;
  name: string;
}

export interface SignalData {
  type: 'offer' | 'answer' | 'ice-candidate';
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  from: string;
  to: string;
}

export type CallState = 'idle' | 'calling' | 'incoming' | 'connected' | 'reconnecting';

export interface CallControlsProps {
  callState: CallState;
  isPTTActive: boolean;
  isAudioMuted: boolean;
  onCall: () => void;
  onAnswer: () => void;
  onHangup: () => void;
  onPTTStart: () => void;
  onPTTEnd: () => void;
  labels?: { hold: string; speaking: string; hangUp: string };
}
