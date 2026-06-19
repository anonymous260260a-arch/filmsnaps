import { VideoSource } from './video-extractor';

/**
 * Generate a secure, isolated video player HTML
 * Includes comprehensive navigation blocking and HLS/DASH support
 */
export function generateVideoPlayerHTML(videoSource: VideoSource): string {
  const isHLS = videoSource.type === 'hls';
  const isDASH = videoSource.type === 'dash';
  const videoUrl = videoSource.url;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn.jsdelivr.net; media-src * blob: data:; connect-src *; navigate-to 'none'; form-action 'none';">
    <title>Secure Video Player</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body, html {
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .player-container {
            width: 100%;
            height: 100%;
            position: relative;
            background: #000;
        }
        video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #000;
        }
        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 18px;
            text-align: center;
            z-index: 10;
        }
        .spinner {
            border: 3px solid rgba(255,255,255,0.3);
            border-top: 3px solid white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .error {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #ff4444;
            font-size: 16px;
            text-align: center;
            z-index: 10;
            padding: 20px;
            max-width: 80%;
        }
        .error-icon {
            font-size: 48px;
            margin-bottom: 10px;
        }
        .custom-controls {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.9));
            padding: 30px 20px 20px;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
        }
        .player-container:hover .custom-controls,
        .custom-controls.visible {
            opacity: 1;
            pointer-events: all;
        }
        .control-bar {
            display: flex;
            align-items: center;
            gap: 15px;
            color: white;
        }
        .btn {
            background: rgba(255,255,255,0.15);
            border: none;
            color: white;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .btn:hover {
            background: rgba(255,255,255,0.25);
            transform: scale(1.05);
        }
        .btn:active {
            transform: scale(0.95);
        }
        .progress-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .progress-bar {
            height: 5px;
            background: rgba(255,255,255,0.3);
            border-radius: 3px;
            cursor: pointer;
            position: relative;
        }
        .progress-bar:hover {
            height: 7px;
        }
        .progress-filled {
            height: 100%;
            background: linear-gradient(90deg, #ff4444, #ff6666);
            border-radius: 3px;
            width: 0%;
            transition: width 0.1s ease;
            position: relative;
        }
        .progress-filled::after {
            content: '';
            position: absolute;
            right: -6px;
            top: 50%;
            transform: translateY(-50%);
            width: 12px;
            height: 12px;
            background: white;
            border-radius: 50%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            opacity: 0;
            transition: opacity 0.2s;
        }
        .progress-bar:hover .progress-filled::after {
            opacity: 1;
        }
        .time-display {
            font-size: 13px;
            color: rgba(255,255,255,0.9);
            font-variant-numeric: tabular-nums;
            min-width: 100px;
            text-align: center;
        }
        .volume-control {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .volume-btn {
            background: transparent;
            border: none;
            color: white;
            cursor: pointer;
            font-size: 20px;
            padding: 5px;
        }
        .volume-slider {
            width: 80px;
            height: 5px;
            background: rgba(255,255,255,0.3);
            border-radius: 3px;
            cursor: pointer;
            position: relative;
        }
        .volume-filled {
            height: 100%;
            background: white;
            border-radius: 3px;
            width: 100%;
            transition: width 0.1s ease;
        }
        .fullscreen-btn {
            background: rgba(255,255,255,0.15);
            border: none;
            color: white;
            padding: 10px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        .fullscreen-btn:hover {
            background: rgba(255,255,255,0.25);
        }
        @media (max-width: 640px) {
            .volume-control {
                display: none;
            }
            .time-display {
                font-size: 11px;
                min-width: 80px;
            }
        }
    </style>
</head>
<body>
    <div class="player-container" id="player-container">
        <div class="loading" id="loading">
            <div class="spinner"></div>
            <div>Loading video...</div>
        </div>
        <video 
            id="video-player" 
            playsinline 
            preload="metadata"
            crossorigin="anonymous"
        ></video>

        <div class="custom-controls" id="custom-controls">
            <div class="control-bar">
                <button class="btn" id="play-pause" title="Play/Pause">▶</button>

                <div class="progress-container">
                    <div class="progress-bar" id="progress-bar">
                        <div class="progress-filled" id="progress-filled"></div>
                    </div>
                </div>

                <div class="time-display" id="time-display">0:00 / 0:00</div>

                <div class="volume-control">
                    <button class="volume-btn" id="volume-btn">🔊</button>
                    <div class="volume-slider" id="volume-slider">
                        <div class="volume-filled" id="volume-filled"></div>
                    </div>
                </div>

                <button class="fullscreen-btn" id="fullscreen">⛶ Fullscreen</button>
            </div>
        </div>
    </div>

    ${isHLS ? '<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>' : ''}
    ${isDASH ? '<script src="https://cdn.jsdelivr.net/npm/dashjs@latest/dist/dash.all.min.js"></script>' : ''}
    
    <script>
        (function() {
            'use strict';
            
            // ============================================
            // ULTRA-AGGRESSIVE NAVIGATION BLOCKING
            // ============================================
            console.log('[SECURE PLAYER] 🔒 Navigation blocking active');
            
            // Prevent script manipulation of location
            const blockNavigation = function(url) {
                console.log('[SECURE PLAYER] ❌ BLOCKED navigation attempt to:', url);
                return false;
            };

            // LAYER 1: Shadow top and parent to prevent frame breakouts
            const locationMock = {
              set href(url) { blockNavigation(url); },
              get href() { return window.location.href; },
              assign: blockNavigation,
              replace: blockNavigation,
              toString: function() { return window.location.toString(); }
            };

            try {
              Object.defineProperty(window, 'top', { get: function() { return { location: locationMock }; } });
              Object.defineProperty(window, 'parent', { get: function() { return { location: locationMock }; } });
            } catch(e) {}

            // LAYER 2: Override window.open
            const originalOpen = window.open;
            window.open = function() {
                console.log('[SECURE PLAYER] ❌ BLOCKED window.open');
                return { closed: true, close: function(){}, focus: function(){}, blur: function(){} };
            };
            
            // LAYER 3: Override location methods
            try {
                Object.defineProperty(window.location, 'href', {
                    set: function(url) { blockNavigation(url); },
                    get: function() { return window.location.toString(); },
                    configurable: true
                });
            } catch(e) {}
            
            try { window.location.assign = blockNavigation; } catch(e) {}
            try { window.location.replace = blockNavigation; } catch(e) {}
            
            // LAYER 4: Block all click/touch events that might trigger popups
            const blockClick = function(e) {
                const target = e.target;
                if (!target) return;

                const link = target.closest('a');
                if (link) {
                   const href = link.getAttribute('href') || link.href;
                   if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                     e.preventDefault();
                     e.stopPropagation();
                     e.stopImmediatePropagation();
                     return blockNavigation(href);
                   }
                }
                
                // Block any element with "onclick" attribute that might navigate
                if (target.hasAttribute && target.hasAttribute('onclick')) {
                    const onclick = target.getAttribute('onclick');
                    if (onclick && (onclick.includes('location') || onclick.includes('open'))) {
                       e.preventDefault();
                       e.stopImmediatePropagation();
                    }
                }
            };
            
            const events = ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu', 'auxclick'];
            events.forEach(event => {
                document.addEventListener(event, blockClick, true);
            });
            
            // LAYER 4: Block history manipulation
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            
            history.pushState = function(state, title, url) {
                if (url && url !== window.location.href && !url.startsWith(window.location.origin)) {
                    console.log('[SECURE PLAYER] ❌ BLOCKED pushState');
                    return;
                }
                return originalPushState.call(history, state, title, url);
            };
            
            history.replaceState = function(state, title, url) {
                if (url && url !== window.location.href && !url.startsWith(window.location.origin)) {
                    console.log('[SECURE PLAYER] ❌ BLOCKED replaceState');
                    return;
                }
                return originalReplaceState.call(history, state, title, url);
            };
            
            // LAYER 5: Block ALL form submissions
            document.addEventListener('submit', function(e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log('[SECURE PLAYER] ❌ BLOCKED form submission');
            }, true);
            
            // Continuous cleanup of attributes
            setInterval(function() {
                try {
                    document.querySelectorAll('a[target], area[target]').forEach(el => el.removeAttribute('target'));
                    document.querySelectorAll('meta[http-equiv="refresh"]').forEach(el => el.remove());
                } catch(e) {}
            }, 500);
            
            // ============================================
            // VIDEO PLAYER INITIALIZATION
            // ============================================
            const video = document.getElementById('video-player');
            const loading = document.getElementById('loading');
            const playerContainer = document.getElementById('player-container');
            const playPauseBtn = document.getElementById('play-pause');
            const progressBar = document.getElementById('progress-bar');
            const progressFilled = document.getElementById('progress-filled');
            const timeDisplay = document.getElementById('time-display');
            const volumeBtn = document.getElementById('volume-btn');
            const volumeSlider = document.getElementById('volume-slider');
            const volumeFilled = document.getElementById('volume-filled');
            const fullscreenBtn = document.getElementById('fullscreen');
            const customControls = document.getElementById('custom-controls');
            
            let hideControlsTimeout;
            
            // Initialize video source
            const videoUrl = ${JSON.stringify(videoUrl)};
            const isHLS = ${isHLS};
            const isDASH = ${isDASH};
            
            console.log('[SECURE PLAYER] Initializing:', { videoUrl, isHLS, isDASH });
            
            // Load video based on type
            if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 90
                });
                hls.loadSource(videoUrl);
                hls.attachMedia(video);
                
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('[SECURE PLAYER] HLS manifest loaded');
                });
                
                hls.on(Hls.Events.ERROR, (event, data) => {
                    console.error('[SECURE PLAYER] HLS error:', data);
                    if (data.fatal) {
                        showError('Failed to load video stream');
                    }
                });
            } else if (isDASH && typeof dashjs !== 'undefined') {
                const player = dashjs.MediaPlayer().create();
                player.initialize(video, videoUrl, false);
                
                player.on(dashjs.MediaPlayer.events.ERROR, (e) => {
                    console.error('[SECURE PLAYER] DASH error:', e);
                    showError('Failed to load video stream');
                });
            } else {
                // Standard MP4/WebM
                video.src = videoUrl;
            }
            
            // Loading states
            video.addEventListener('loadstart', () => {
                loading.style.display = 'block';
            });
            
            video.addEventListener('canplay', () => {
                loading.style.display = 'none';
                console.log('[SECURE PLAYER] Video ready to play');
            });
            
            video.addEventListener('error', (e) => {
                console.error('[SECURE PLAYER] Video error:', e);
                showError('Error loading video<br><small>The video source may not be available</small>');
            });
            
            function showError(message) {
                loading.style.display = 'none';
                playerContainer.innerHTML = '<div class="error"><div class="error-icon">⚠️</div>' + message + '</div>';
            }
            
            // Play/Pause
            playPauseBtn.addEventListener('click', togglePlayPause);
            video.addEventListener('click', togglePlayPause);
            
            function togglePlayPause() {
                if (video.paused) {
                    video.play().catch(e => console.error('[SECURE PLAYER] Play failed:', e));
                } else {
                    video.pause();
                }
            }
            
            video.addEventListener('play', () => {
                playPauseBtn.textContent = '⏸';
            });
            
            video.addEventListener('pause', () => {
                playPauseBtn.textContent = '▶';
            });
            
            // Progress bar
            video.addEventListener('timeupdate', () => {
                if (!video.duration) return;
                const progress = (video.currentTime / video.duration) * 100;
                progressFilled.style.width = progress + '%';
                timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
            });
            
            progressBar.addEventListener('click', (e) => {
                if (!video.duration) return;
                const rect = progressBar.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                video.currentTime = percent * video.duration;
            });
            
            function formatTime(seconds) {
                if (!isFinite(seconds)) return '0:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return mins + ':' + (secs < 10 ? '0' : '') + secs;
            }
            
            // Volume control
            volumeBtn.addEventListener('click', () => {
                if (video.volume > 0) {
                    video.dataset.prevVolume = video.volume;
                    video.volume = 0;
                } else {
                    video.volume = parseFloat(video.dataset.prevVolume || 0.5);
                }
            });
            
            volumeSlider.addEventListener('click', (e) => {
                const rect = volumeSlider.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                video.volume = Math.max(0, Math.min(1, percent));
            });
            
            video.addEventListener('volumechange', () => {
                volumeFilled.style.width = (video.volume * 100) + '%';
                volumeBtn.textContent = video.volume === 0 ? '🔇' : video.volume < 0.5 ? '🔉' : '🔊';
            });
            
            // Fullscreen
            fullscreenBtn.addEventListener('click', () => {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    playerContainer.requestFullscreen().catch(err => {
                        console.error('[SECURE PLAYER] Fullscreen error:', err);
                    });
                }
            });
            
            document.addEventListener('fullscreenchange', () => {
                fullscreenBtn.textContent = document.fullscreenElement ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
            });
            
            // Auto-hide controls
            playerContainer.addEventListener('mousemove', () => {
                customControls.classList.add('visible');
                clearTimeout(hideControlsTimeout);
                hideControlsTimeout = setTimeout(() => {
                    if (!video.paused) {
                        customControls.classList.remove('visible');
                    }
                }, 3000);
            });
            
            playerContainer.addEventListener('mouseleave', () => {
                if (!video.paused) {
                    customControls.classList.remove('visible');
                }
            });
            
            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                switch(e.code) {
                    case 'Space':
                    case 'KeyK':
                        e.preventDefault();
                        togglePlayPause();
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        video.currentTime = Math.max(0, video.currentTime - 10);
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        video.currentTime = Math.min(video.duration, video.currentTime + 10);
                        break;
                    case 'KeyF':
                        e.preventDefault();
                        fullscreenBtn.click();
                        break;
                    case 'KeyM':
                        e.preventDefault();
                        volumeBtn.click();
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        video.volume = Math.min(1, video.volume + 0.1);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        video.volume = Math.max(0, video.volume - 0.1);
                        break;
                }
            });
            
            console.log('[SECURE PLAYER] ✅ Player initialized successfully');
        })();
    </script>
</body>
</html>`;
}
