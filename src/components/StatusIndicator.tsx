import { CallState } from '@/types/webrtc';
import { Loader2, CheckCircle2, Phone, AlertCircle } from 'lucide-react';

interface StatusIndicatorProps {
  callState: CallState;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
}

const StatusIndicator = ({ callState, connectionStatus }: StatusIndicatorProps) => {
  const getStatusInfo = () => {
    if (connectionStatus !== 'connected') {
      return {
        icon: <AlertCircle className="w-5 h-5 text-destructive" />,
        text: connectionStatus === 'connecting' ? 'Connecting to server...' : 'Disconnected from server',
        color: 'text-destructive',
      };
    }

    switch (callState) {
      case 'calling':
        return {
          icon: <Loader2 className="w-5 h-5 text-warning animate-spin" />,
          text: 'Calling...',
          color: 'text-warning',
        };
      case 'incoming':
        return {
          icon: <Phone className="w-5 h-5 text-success animate-pulse" />,
          text: 'Incoming call',
          color: 'text-success',
        };
      case 'connected':
        return {
          icon: <CheckCircle2 className="w-5 h-5 text-success" />,
          text: 'Connected',
          color: 'text-success',
        };
      case 'reconnecting':
        return {
          icon: <Loader2 className="w-5 h-5 text-warning animate-spin" />,
          text: 'Reconnecting...',
          color: 'text-warning',
        };
      default:
        return {
          icon: <CheckCircle2 className="w-5 h-5 text-success" />,
          text: 'Connected to server',
          color: 'text-success',
        };
    }
  };

  const { icon, text, color } = getStatusInfo();

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-card rounded-lg border border-border">
      {icon}
      <span className={`text-sm font-medium ${color}`}>{text}</span>
    </div>
  );
};

export default StatusIndicator;
