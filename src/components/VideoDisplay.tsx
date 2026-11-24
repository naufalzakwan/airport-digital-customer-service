import { forwardRef, useEffect } from 'react';
import { User, Video, VideoOff } from 'lucide-react';

interface VideoDisplayProps {
  isLocal?: boolean;
  userName?: string;
  isConnected?: boolean;
  fit?: 'cover' | 'contain';
  labels?: { you: string; live: string };
}

const VideoDisplay = forwardRef<HTMLVideoElement, VideoDisplayProps>(
  ({ isLocal = false, userName, isConnected = false, fit = 'cover', labels }, ref) => {
    // Set volume for remote video
    useEffect(() => {
      if (!isLocal && ref && typeof ref === 'object' && ref.current) {
        ref.current.volume = 1.0;
        console.log('Remote video volume set to:', ref.current.volume);
      }
    }, [isLocal, ref]);

    return (
      <div className="relative w-full h-full bg-video-bg rounded-xl overflow-hidden shadow-2xl">
        <video
          ref={ref}
          data-video-role={isLocal ? 'local' : 'remote'}
          autoPlay
          playsInline
          muted={isLocal}
          onClick={(event) => {
            if (!isLocal && event.currentTarget.paused && event.currentTarget.srcObject) {
              void event.currentTarget.play().catch(() => {
                console.warn('Remote media playback is still blocked by the browser.');
              });
            }
          }}
          className={`w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
        />

        {/* Overlay when no video */}
        {!isConnected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-video-bg">
            <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center mb-4">
              <User className="w-12 h-12 text-muted-foreground" />
            </div>
            <p className="text-foreground font-medium">
              {userName || (isLocal ? 'You' : 'Waiting...')}
            </p>
          </div>
        )}

        {/* User label */}
        <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-background/80 backdrop-blur-sm rounded-lg">
          <p className="text-sm font-medium text-foreground">
              {isLocal ? labels?.you || 'You' : userName || 'Remote User'}
          </p>
        </div>

        {/* Video indicator */}
        <div className="absolute top-4 right-4">
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-success/20 backdrop-blur-sm rounded-lg">
              <Video className="w-4 h-4 text-success" />
              <span className="text-xs font-medium text-success">{labels?.live || 'Live'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/20 backdrop-blur-sm rounded-lg">
              <VideoOff className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    );
  }
);

VideoDisplay.displayName = 'VideoDisplay';

export default VideoDisplay;
