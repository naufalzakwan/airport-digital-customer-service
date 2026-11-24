// Opt in from the browser console: localStorage.setItem('echo.webrtc.debug', '1')
// Reload before the call. No SDP, ICE addresses, device labels or IDs are logged.
export const webRTCDebugEnabled = () => {
  try {
    return new URLSearchParams(window.location.search).get('webrtcDebug') === '1' || localStorage.getItem('echo.webrtc.debug') === '1';
  } catch {
    return false;
  }
};

export const describeTrack = (track: MediaStreamTrack | null) => track && ({
  kind: track.kind,
  readyState: track.readyState,
  enabled: track.enabled,
  muted: track.muted,
});

// Only expose media counters and state; never expose SDP, ICE, IDs or device labels.
export const collectVideoDiagnostics = async (pc: RTCPeerConnection, video: HTMLVideoElement | null, local: MediaStream | null) => {
  const stats = await pc.getStats();
  const videoReceivers = pc.getReceivers().filter(receiver => receiver.track?.kind === 'video');
  const receiverStats = await Promise.all(videoReceivers.map(receiver => receiver.getStats().catch(() => null)));
  const receiverReportIds = new Set<string>();
  receiverStats.forEach(report => report?.forEach(item => { if (item.type === 'inbound-rtp') receiverReportIds.add(item.id); }));
  const videoStats: object[] = [];
  let decodedFrames = 0;
  stats.forEach(report => {
    if ((report.type !== 'outbound-rtp' && report.type !== 'inbound-rtp') || (report.kind !== 'video' && report.mediaType !== 'video')) return;
    const codec = report.codecId ? stats.get(report.codecId) : undefined;
    const fromActiveVideoReceiver = report.type === 'inbound-rtp' && receiverStats.every(Boolean) ? receiverReportIds.has(report.id) : null;
    if (fromActiveVideoReceiver) decodedFrames += report.framesDecoded || 0;
    videoStats.push({ type: report.type, fromActiveVideoReceiver, codec: codec?.mimeType, bytesSent: report.bytesSent, framesSent: report.framesSent, framesEncoded: report.framesEncoded, bytesReceived: report.bytesReceived, framesReceived: report.framesReceived, framesDecoded: report.framesDecoded, framesPerSecond: report.framesPerSecond });
  });
  const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
  const videoTracks = stream?.getVideoTracks() || [];
  const style = video ? getComputedStyle(video) : null;
  const rect = video?.getBoundingClientRect();
  const center = rect && rect.width && rect.height ? document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : [];
  let pixels: { meanBrightness: number; nearBlackPercent: number } | null = null;
  if (video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(video, 0, 0, 32, 32);
        const data = context.getImageData(0, 0, 32, 32).data;
        let total = 0, black = 0;
        for (let i = 0; i < data.length; i += 4) { const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3; total += brightness; if (brightness < 16) black++; }
        pixels = { meanBrightness: Math.round(total / 1024), nearBlackPercent: Math.round(black * 100 / 1024) };
      }
    } catch { /* Canvas sampling can be unavailable; playback continues. */ }
  }
  return {
    timestamp: new Date().toISOString(),
    connection: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState,
    localTracks: local?.getTracks().map(describeTrack),
    senders: pc.getSenders().map(sender => describeTrack(sender.track)),
    receivers: pc.getReceivers().map(receiver => describeTrack(receiver.track)),
    transceivers: pc.getTransceivers().map(t => ({ kind: t.sender.track?.kind || t.receiver.track?.kind, direction: t.direction, currentDirection: t.currentDirection })),
    videoStats, decodedFrames,
    playback: video && { elementRole: video.dataset.videoRole, isMainRemoteElement: video === document.querySelector('.call-video-main > div:first-child video[data-video-role="remote"]'), isConnectedToDOM: video.isConnected, streamAttached: !!stream, receiverTrackIdMatchesStream: videoReceivers.some(receiver => videoTracks.some(track => track.id === receiver.track.id)), streamTracks: stream?.getTracks().map(describeTrack), readyState: video.readyState, paused: video.paused, videoWidth: video.videoWidth, videoHeight: video.videoHeight, width: Math.round(rect?.width || 0), height: Math.round(rect?.height || 0), display: style?.display, visibility: style?.visibility, opacity: style?.opacity, objectFit: style?.objectFit, centerHitsVideo: center.includes(video), centerTopElement: center[0]?.tagName || null, pixels },
  };
};

export const logPeerDiagnostics = (pc: RTCPeerConnection, label: string) => {
  if (!webRTCDebugEnabled()) return;
  console.debug('[Echo WebRTC]', label, {
    connection: pc.connectionState,
    ice: pc.iceConnectionState,
    signaling: pc.signalingState,
    senders: pc.getSenders().map(sender => describeTrack(sender.track)),
    receivers: pc.getReceivers().map(receiver => describeTrack(receiver.track)),
    transceivers: pc.getTransceivers().map(transceiver => ({
      kind: transceiver.sender.track?.kind || transceiver.receiver.track?.kind,
      direction: transceiver.direction,
      currentDirection: transceiver.currentDirection,
    })),
  });
};

export const logVideoStats = async (pc: RTCPeerConnection, video: HTMLVideoElement | null) => {
  if (!webRTCDebugEnabled() || pc.signalingState === 'closed') return;
  try {
    const stats = await pc.getStats();
    const videoStats: object[] = [];
    stats.forEach(report => {
      if ((report.type === 'outbound-rtp' || report.type === 'inbound-rtp') &&
          (report.kind === 'video' || report.mediaType === 'video')) {
        videoStats.push({
          type: report.type,
          bytesSent: report.bytesSent,
          framesEncoded: report.framesEncoded,
          framesSent: report.framesSent,
          bytesReceived: report.bytesReceived,
          framesReceived: report.framesReceived,
          framesDecoded: report.framesDecoded,
          framesDropped: report.framesDropped,
        });
      }
    });
    console.debug('[Echo WebRTC] video stats', {
      videoStats,
      playback: video && {
        readyState: video.readyState,
        paused: video.paused,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      },
    });
  } catch (error) {
    console.debug('[Echo WebRTC] getStats unavailable', error instanceof Error ? error.name : 'unknown');
  }
};
