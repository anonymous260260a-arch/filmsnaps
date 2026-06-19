'use client';

import { useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  videoUrl: string;
  provider: string;
  onError?: (error: string) => void;
}

export function CustomVideoPlayer({ videoUrl, provider, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHLS, setIsHLS] = useState(false);
  const hlsRef = useRef<any>(null);

  useEffect(() => {
    if (!videoUrl || !videoRef.current) return;

    const video = videoRef.current;
    const isM3U8 = videoUrl.includes('.m3u8') || videoUrl.includes('m3u8');
    const isMPD = videoUrl.includes('.mpd') || videoUrl.includes('dash');
    
    setIsHLS(isM3U8);

    // Cleanup function
    const cleanup = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = '';
      video.load();
    };

    const initPlayer = async () => {
      try {
        setLoading(true);
        setError(null);

        if (isM3U8) {
          // HLS playback using hls.js
          const Hls = (await import('hls.js')).default;
          
          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              backBufferLength: 90,
              xhrSetup: (xhr: XMLHttpRequest, url: string) => {
                xhr.setRequestHeader('Accept', '*/*');
              },
            });
            
            hlsRef.current = hls;
            hls.loadSource(videoUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log('[CustomPlayer] HLS manifest loaded');
              setLoading(false);
              video.play().catch(e => console.log('[CustomPlayer] Auto-play prevented:', e));
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
              console.error('[CustomPlayer] HLS error:', data);
              if (data.fatal) {
                setError('Failed to load video stream');
                setLoading(false);
                onError?.(`HLS Error: ${data.type} - ${data.details}`);
              }
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            video.src = videoUrl;
            video.addEventListener('loadeddata', () => {
              setLoading(false);
              video.play().catch(e => console.log('[CustomPlayer] Auto-play prevented:', e));
            });
          } else {
            setError('HLS playback not supported');
            setLoading(false);
          }
        } else if (isMPD) {
          // DASH playback using dash.js
          const { MediaPlayer } = await import('dashjs');
          const player = MediaPlayer().create();
          player.initialize(video, videoUrl, true);

          player.on(MediaPlayer.events.MANIFEST_LOADED, () => {
            setLoading(false);
          });

          player.on(MediaPlayer.events.ERROR, (e: any) => {
            console.error('[CustomPlayer] DASH error:', e);
            setError('Failed to load video stream');
            setLoading(false);
          });
        } else {
          // Standard MP4/WebM playback
          video.src = videoUrl;
          video.addEventListener('loadeddata', () => {
            setLoading(false);
            video.play().catch(e => console.log('[CustomPlayer] Auto-play prevented:', e));
          });
        }

        video.addEventListener('error', (e) => {
          console.error('[CustomPlayer] Video error:', e);
          setError('Error loading video');
          setLoading(false);
          onError?.('Video element error');
        });

      } catch (err) {
        console.error('[CustomPlayer] Init error:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize player');
        setLoading(false);
        onError?.(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    initPlayer();

    return cleanup;
  }, [videoUrl, onError]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      {/* Loading State */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="text-white text-center">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm">Loading video...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="text-white text-center p-6">
            <div className="text-red-500 text-4xl mb-4">⚠️</div>
            <p className="text-lg font-semibold mb-2">{error}</p>
            <p className="text-sm text-gray-400">Try switching to a different server</p>
          </div>
        </div>
      )}

      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        autoPlay
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
      />
    </div>
  );
}

export default CustomVideoPlayer;
