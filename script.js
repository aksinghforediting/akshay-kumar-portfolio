const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();

const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('#nav-links');

if (menuToggle && navLinks) {
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
    navLinks.classList.toggle('open', !isOpen);
  });

  navLinks.addEventListener('click', (event) => {
    if (!event.target.closest('a')) return;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
    navLinks.classList.remove('open');
  });
}

const formatVideoTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
    : minutes + ':' + String(remainder).padStart(2, '0');
};

const playerIcons = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm12-1v2a3 3 0 0 1 0 4v2a5 5 0 0 0 0-8zm0-4v2a8 8 0 0 1 0 12v2a10 10 0 0 0 0-16z"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
  exitFullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4v6H4V8h4V4zm10 4v2h-6V4h2v4zM8 20v-4H4v-2h6v6zm12-6v2h-4v4h-2v-6z"/></svg>'
};
const videoPlayers = [...document.querySelectorAll('.video-player')];
let activeVideo = null;
const orientationLockStates = new WeakMap();
const fullscreenReturnStates = new WeakMap();
const fullscreenScrollRestorations = new WeakMap();
const mobileVideoViewport = window.matchMedia('(max-width: 680px)');
const pendingControlAdjustments = new Set();
const finishPendingControlAdjustments = () => {
  pendingControlAdjustments.forEach((finish) => finish());
};
window.addEventListener('pointerup', finishPendingControlAdjustments);
window.addEventListener('pointercancel', finishPendingControlAdjustments);

const coordinateVideoPlayback = (playingVideo) => {
  activeVideo = playingVideo;
  videoPlayers.forEach((player) => {
    const otherVideo = player.querySelector('.portfolio-video');
    if (otherVideo && otherVideo !== playingVideo && !otherVideo.paused) otherVideo.pause();
  });
};

const playerIsFullscreen = (player) =>
  (document.fullscreenElement || document.webkitFullscreenElement) === player ||
  player.classList.contains('video-fullscreen-fallback');

const playerHasLandscapeVideo = (player) => {
  const video = player.querySelector('.portfolio-video');
  return video?.videoWidth && video?.videoHeight
    ? video.videoWidth > video.videoHeight
    : player.dataset.orientation === 'landscape';
};

const releasePlayerOrientation = (player) => {
  const state = orientationLockStates.get(player);
  if (state) state.active = false;
  const orientation = state?.orientation || screen.orientation;
  try { orientation?.unlock(); } catch { /* Unlock is best-effort across browsers. */ }
  if (orientationLockStates.get(player) === state) orientationLockStates.delete(player);
};

const cancelFullscreenScrollRestoration = (player) => {
  fullscreenScrollRestorations.get(player)?.();
};

const rememberFullscreenReturnState = (player) => {
  cancelFullscreenScrollRestoration(player);
  const viewport = player.querySelector('.video-viewport');
  const orientation = screen.orientation;
  const state = {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    orientationType: orientation?.type || '',
    wasLandscapeViewport: window.innerWidth > window.innerHeight,
    url: window.location.href,
    historyState: history.state,
    viewportWidth: viewport?.style.width || '',
    viewportHeight: viewport?.style.height || '',
    viewportAspectRatio: viewport?.style.aspectRatio || '',
    exitPromise: null
  };
  fullscreenReturnStates.set(player, state);
};

const restoreFullscreenScrollPosition = (player, state) => {
  let settleTimer = 0;
  let timeout = 0;
  let restored = false;
  let cancelled = false;
  let completed = false;
  let firstFrame = 0;
  let secondFrame = 0;
  const orientation = screen.orientation;
  const hasExpectedOrientation = () => orientation?.type
    ? orientation.type === state.orientationType
    : (window.innerWidth > window.innerHeight) === state.wasLandscapeViewport;
  const cleanup = () => {
    window.clearTimeout(settleTimer);
    window.clearTimeout(timeout);
    window.removeEventListener('orientationchange', scheduleRestore);
    window.removeEventListener('resize', scheduleRestore);
    window.visualViewport?.removeEventListener('resize', scheduleRestore);
    orientation?.removeEventListener?.('change', scheduleRestore);
  };
  const restore = () => {
    if (restored || cancelled) return;
    restored = true;
    cleanup();
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0;
        if (cancelled) return;
        const root = document.documentElement;
        const previousScrollBehavior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(state.scrollX, state.scrollY);
        root.style.scrollBehavior = previousScrollBehavior;
        completed = true;
        if (fullscreenScrollRestorations.get(player) === cancel) fullscreenScrollRestorations.delete(player);
      });
    });
  };
  function scheduleRestore() {
    window.clearTimeout(settleTimer);
    if (hasExpectedOrientation()) settleTimer = window.setTimeout(restore, 100);
  }
  const cancel = () => {
    if (completed || cancelled) return;
    cancelled = true;
    cleanup();
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    if (fullscreenScrollRestorations.get(player) === cancel) fullscreenScrollRestorations.delete(player);
  };

  fullscreenScrollRestorations.set(player, cancel);
  window.addEventListener('orientationchange', scheduleRestore, { passive: true });
  window.addEventListener('resize', scheduleRestore, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleRestore, { passive: true });
  orientation?.addEventListener?.('change', scheduleRestore);
  timeout = window.setTimeout(restore, 1500); // Failsafe only; orientation is driven by browser events and the lock API.
  scheduleRestore();
};

const restoreFullscreenReturnState = (player) => {
  const state = fullscreenReturnStates.get(player);
  if (!state) {
    if (orientationLockStates.has(player)) releasePlayerOrientation(player);
    return;
  }
  fullscreenReturnStates.delete(player);
  releasePlayerOrientation(player);
  player.classList.remove('video-fullscreen-pending');
  player.classList.remove('video-fullscreen-fallback');
  const viewport = player.querySelector('.video-viewport');
  if (viewport) {
    viewport.style.width = state.viewportWidth;
    viewport.style.height = state.viewportHeight;
    viewport.style.aspectRatio = state.viewportAspectRatio;
  }
  setFullscreenIcons();
  restoreFullscreenScrollPosition(player, state);
  if (state.historyEntry && history.state?.portfolioVideoFullscreen) history.back();
};

const lockLandscapeForMobilePlayer = (player) => {
  const orientation = screen.orientation;
  if (!mobileVideoViewport.matches || !orientation || typeof orientation.lock !== 'function') return;
  if (!playerHasLandscapeVideo(player)) return;

  const state = { active: true, locked: false, orientation };
  orientationLockStates.set(player, state);
  let lockRequest;
  try {
    lockRequest = orientation.lock('landscape');
  } catch {
    orientationLockStates.delete(player);
    return;
  }
  Promise.resolve(lockRequest).then(() => {
    state.locked = true;
    if (!state.active || !playerIsFullscreen(player)) {
      state.active = false;
      const currentState = orientationLockStates.get(player);
      if (!currentState || currentState === state) {
        try { orientation.unlock(); } catch { /* A late lock must not outlive fullscreen. */ }
        if (currentState === state) orientationLockStates.delete(player);
      }
    }
  }).catch(() => {
    if (orientationLockStates.get(player) === state) orientationLockStates.delete(player);
  });
};

const requestPortraitBeforeExit = async (player) => {
  const orientation = orientationLockStates.get(player)?.orientation || screen.orientation;
  if (!playerIsFullscreen(player) || typeof orientation?.lock !== 'function') return;
  try {
    await orientation.lock('portrait');
  } catch {
    // Some browsers only restore their default orientation when fullscreen exits.
  }
};

const enterPlayerFullscreen = async (player) => {
  if (playerIsFullscreen(player)) return true;
  if (mobileVideoViewport.matches && !playerHasLandscapeVideo(player)) {
    // Keep portrait videos and Shorts on their existing CSS fullscreen overlay.
    player.classList.add('video-fullscreen-fallback');
    if (!history.state?.portfolioVideoFullscreen) {
      history.pushState({ ...(history.state || {}), portfolioVideoFullscreen: true }, '', window.location.href);
    }
    setFullscreenIcons();
    return true;
  }
  if (mobileVideoViewport.matches) rememberFullscreenReturnState(player);
  const usePendingLandscapeCover = mobileVideoViewport.matches && playerHasLandscapeVideo(player);
  if (usePendingLandscapeCover) player.classList.add('video-fullscreen-pending');
  try {
    if (player.requestFullscreen) await player.requestFullscreen({ navigationUI: 'hide' });
    else if (player.webkitRequestFullscreen) await player.webkitRequestFullscreen();
    else throw new Error('Fullscreen API unavailable');
    player.classList.remove('video-fullscreen-pending');
    if (playerIsFullscreen(player)) lockLandscapeForMobilePlayer(player);
    return true;
  } catch {
    player.classList.remove('video-fullscreen-pending');
    player.classList.add('video-fullscreen-fallback');
    if (!history.state?.portfolioVideoFullscreen) {
      history.pushState({ ...(history.state || {}), portfolioVideoFullscreen: true }, '', window.location.href);
      const returnState = fullscreenReturnStates.get(player);
      if (returnState) returnState.historyEntry = true;
    }
    setFullscreenIcons();
    return false;
  }
};

const exitPlayerFullscreen = async (player) => {
  if (player.classList.contains('video-fullscreen-fallback')) {
    if (fullscreenReturnStates.has(player)) restoreFullscreenReturnState(player);
    else {
      releasePlayerOrientation(player);
      player.classList.remove('video-fullscreen-fallback');
      const viewport = player.querySelector('.video-viewport');
      if (viewport) {
        viewport.style.width = '';
        viewport.style.height = '';
      }
      setFullscreenIcons();
      if (history.state?.portfolioVideoFullscreen) history.back();
    }
    return;
  }
  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
  if (exitFullscreen) {
    const returnState = fullscreenReturnStates.get(player);
    if (returnState?.exitPromise) return returnState.exitPromise;
    const exitTask = (async () => {
      await requestPortraitBeforeExit(player);
      await exitFullscreen.call(document);
    })();
    if (returnState) returnState.exitPromise = exitTask;
    try {
      await exitTask;
    } finally {
      if (returnState && fullscreenReturnStates.get(player) === returnState) returnState.exitPromise = null;
    }
  }
};

const setFullscreenIcons = () => {
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  videoPlayers.forEach((player) => {
    const button = player.querySelector('[data-action="fullscreen"]');
    if (!button) return;
    const active = fullscreenElement === player || player.classList.contains('video-fullscreen-fallback');
    button.innerHTML = active ? playerIcons.exitFullscreen : playerIcons.fullscreen;
    button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    button.setAttribute('aria-pressed', String(active));
  });
};

videoPlayers.forEach((player) => {
  const video = player.querySelector('.portfolio-video');
  const controls = player.querySelector('.video-controls');
  const viewport = player.querySelector('.video-viewport');
  const startButton = viewport && viewport.querySelector('[data-video-start]');
  const error = player.querySelector('.video-error');
  const template = document.querySelector('#video-control-template');
  if (!video || !controls || !viewport || !startButton || !template) return;

  controls.replaceChildren(template.content.cloneNode(true));
  const query = (selector) => controls.querySelector(selector);
  const seek = query('[data-video-seek]');
  const played = query('[data-played-progress]');
  const buffered = query('[data-buffered-progress]');
  const current = query('[data-current-time]');
  const total = query('[data-duration]');
  const playButton = query('[data-action="play"]');
  const muteButton = query('[data-action="mute"]');
  const volume = query('[data-video-volume]');
  const fullscreenButton = query('[data-action="fullscreen"]');
  if ([seek, played, buffered, current, total, playButton, muteButton, volume, fullscreenButton].some((node) => !node)) return;

  const state = { dragging: false, adjustingControl: false, hideTimer: 0, hasStarted: false, lastVolume: video.volume || 1 };
  const hasDuration = () => Number.isFinite(video.duration) && video.duration > 0;
  const setError = (message) => {
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  };
  const cancelTimer = () => {
    window.clearTimeout(state.hideTimer);
    state.hideTimer = 0;
    player._videoHideTimer = 0;
  };
  const showControls = (schedule = true, force = false) => {
    if (!state.hasStarted && !force) return;
    controls.hidden = false;
    player.classList.remove('controls-hidden');
    if (!schedule || video.paused || video.ended || state.dragging || state.adjustingControl) {
      cancelTimer();
      return;
    }
    cancelTimer();
    state.hideTimer = window.setTimeout(() => {
      state.hideTimer = 0;
      player._videoHideTimer = 0;
      if (!video.paused && !video.ended && !state.dragging && !state.adjustingControl) player.classList.add('controls-hidden');
    }, 1000);
    player._videoHideTimer = state.hideTimer;
  };
  const updatePlay = () => {
    const isPlaying = !video.paused && !video.ended;
    playButton.innerHTML = isPlaying ? playerIcons.pause : playerIcons.play;
    playButton.setAttribute('aria-label', isPlaying ? 'Pause video' : 'Play video');
    playButton.title = isPlaying ? 'Pause video' : 'Play video';
    playButton.setAttribute('aria-pressed', String(isPlaying));
  };
  const updateVolume = () => {
    const isMuted = video.muted || video.volume === 0;
    muteButton.innerHTML = isMuted ? playerIcons.muted : playerIcons.volume;
    muteButton.setAttribute('aria-label', isMuted ? 'Unmute video' : 'Mute video');
    muteButton.title = isMuted ? 'Unmute video' : 'Mute video';
    muteButton.setAttribute('aria-pressed', String(isMuted));
    volume.value = String(isMuted ? 0 : video.volume);
  };
  const updateTimeline = () => {
    const known = hasDuration();
    const percent = known ? Math.max(0, Math.min(100, video.currentTime / video.duration * 100)) : 0;
    seek.setAttribute('aria-disabled', String(!known));
    seek.setAttribute('aria-valuemax', known ? String(Math.floor(video.duration)) : '0');
    seek.setAttribute('aria-valuenow', known ? String(Math.floor(video.currentTime)) : '0');
    seek.setAttribute('aria-valuetext', known ? formatVideoTime(video.currentTime) + ' of ' + formatVideoTime(video.duration) : 'Duration unavailable');
    played.style.width = percent + '%';
    seek.style.setProperty('--video-progress', percent + '%');
    if (known && video.buffered.length) buffered.style.width = Math.min(100, video.buffered.end(video.buffered.length - 1) / video.duration * 100) + '%';
    current.textContent = formatVideoTime(video.currentTime);
    total.textContent = formatVideoTime(video.duration);
  };
  const updateVideoLayout = () => {
    const hasVideoDimensions = video.videoWidth > 0 && video.videoHeight > 0;
    const portraitFallback = player.dataset.orientation === 'portrait';
    const videoWidth = hasVideoDimensions ? video.videoWidth : (portraitFallback ? 9 : 16);
    const videoHeight = hasVideoDimensions ? video.videoHeight : (portraitFallback ? 16 : 9);
    if (hasVideoDimensions) player.dataset.orientation = videoWidth >= videoHeight ? 'landscape' : 'portrait';
    viewport.style.aspectRatio = videoWidth + ' / ' + videoHeight;

    if (playerIsFullscreen(player)) {
      const viewWidth = Math.max(1, window.visualViewport?.width || window.innerWidth);
      const viewHeight = Math.max(1, window.visualViewport?.height || window.innerHeight);
      const scale = Math.min(viewWidth / videoWidth, viewHeight / videoHeight);
      viewport.style.width = Math.round(videoWidth * scale) + 'px';
      viewport.style.height = Math.round(videoHeight * scale) + 'px';
    } else {
      viewport.style.width = videoWidth < videoHeight ? 'min(100%, 360px)' : '';
      viewport.style.height = '';
    }
  };
  const seekPointer = (event) => {
    if (!hasDuration()) return;
    const rect = seek.getBoundingClientRect();
    if (!rect.width) return;
    video.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * video.duration;
    updateTimeline();
  };
  const showPlaybackError = () => {
    const messages = {
      2: 'The video could not be loaded. Check that its MP4 file is present in the assets folder.',
      3: 'This browser could not decode the MP4 video.',
      4: 'This browser does not support this MP4 video format.'
    };
    setError(messages[video.error && video.error.code] || 'The video could not be played in this browser.');
    showControls(false, true);
  };

  controls.hidden = true;
  video.controls = false;
  volume.value = String(video.volume);
  fullscreenButton.disabled = false;
  updatePlay();
  updateVolume();
  updateTimeline();
  updateVideoLayout();

  const playFromUserAction = () => {
    if (window.matchMedia('(max-width: 680px)').matches && !playerIsFullscreen(player)) {
      enterPlayerFullscreen(player);
    }
    if (video.paused || video.ended) video.play().catch(showPlaybackError);
  };
  startButton.addEventListener('click', playFromUserAction);
  playButton.addEventListener('click', () => {
    if (video.paused || video.ended) playFromUserAction();
    else video.pause();
    showControls();
  });
  muteButton.addEventListener('click', () => {
    video.muted = !(video.muted || video.volume === 0);
    if (!video.muted && video.volume === 0) video.volume = state.lastVolume || 0.5;
    showControls();
  });
  volume.addEventListener('input', () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
    if (video.volume > 0) state.lastVolume = video.volume;
    showControls();
  });
  const finishControlAdjustment = () => {
    if (!state.adjustingControl) return;
    state.adjustingControl = false;
    pendingControlAdjustments.delete(finishControlAdjustment);
    showControls();
  };
  controls.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('button, input')) return;
    state.adjustingControl = true;
    pendingControlAdjustments.add(finishControlAdjustment);
    showControls(false);
  });
  fullscreenButton.addEventListener('click', async () => {
    setError('');
    showControls();
    try {
      if (playerIsFullscreen(player)) await exitPlayerFullscreen(player);
      else await enterPlayerFullscreen(player);
    } catch {
      setError('Fullscreen is unavailable in this browser. You can continue playback inline.');
    }
  });

  seek.addEventListener('pointerdown', (event) => {
    if (!hasDuration()) return;
    state.dragging = true;
    showControls(false);
    seek.setPointerCapture?.(event.pointerId);
    seekPointer(event);
    event.preventDefault();
  });
  seek.addEventListener('pointermove', (event) => { if (state.dragging) seekPointer(event); });
  const endSeek = (event) => {
    if (!state.dragging) return;
    state.dragging = false;
    try { seek.releasePointerCapture?.(event.pointerId); } catch { /* Pointer capture can already be released. */ }
    showControls();
  };
  seek.addEventListener('pointerup', endSeek);
  seek.addEventListener('pointercancel', endSeek);
  seek.addEventListener('keydown', (event) => {
    if (!hasDuration()) return;
    let target;
    if (event.key === 'ArrowLeft') target = video.currentTime - 1;
    else if (event.key === 'ArrowRight') target = video.currentTime + 1;
    else if (event.key === 'PageDown') target = video.currentTime - video.duration * 0.1;
    else if (event.key === 'PageUp') target = video.currentTime + video.duration * 0.1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = video.duration;
    else return;
    event.preventDefault();
    video.currentTime = Math.max(0, Math.min(video.duration, target));
    updateTimeline();
    showControls();
  });

  player.addEventListener('pointermove', () => showControls(), { passive: true });
  player.addEventListener('pointerleave', () => { if (!video.paused && !state.dragging) showControls(); }, { passive: true });
  player.addEventListener('focusin', () => showControls());
  player.addEventListener('focusout', () => {
    if (!player.contains(document.activeElement) && !video.paused) showControls();
  });
  player.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable)) {
      showControls();
      return;
    }
    if (event.key === ' ' && target === player) {
      event.preventDefault();
      if (video.paused || video.ended) video.play().catch(showPlaybackError);
      else video.pause();
    } else if (event.key === 'Escape' && playerIsFullscreen(player)) {
      exitPlayerFullscreen(player);
    } else if (event.key === 'Tab' || target === player) showControls();
  });
  viewport.addEventListener('click', (event) => {
    if (!event.target.closest('.video-controls')) showControls();
  });

  video.addEventListener('loadedmetadata', () => { updateTimeline(); updateVideoLayout(); setError(''); });
  video.addEventListener('durationchange', updateTimeline);
  video.addEventListener('timeupdate', updateTimeline);
  video.addEventListener('progress', updateTimeline);
  video.addEventListener('seeked', updateTimeline);
  video.addEventListener('play', () => {
    state.hasStarted = true;
    startButton.hidden = true;
    controls.hidden = false;
    coordinateVideoPlayback(video);
    updatePlay();
    showControls();
  });
  video.addEventListener('pause', () => {
    updatePlay();
    if (activeVideo === video) activeVideo = null;
    cancelTimer();
    if (state.hasStarted) showControls(false);
  });
  video.addEventListener('ended', () => {
    updatePlay();
    if (activeVideo === video) activeVideo = null;
    cancelTimer();
    if (state.hasStarted) showControls(false);
  });
  video.addEventListener('volumechange', updateVolume);
  video.addEventListener('error', showPlaybackError);
  const handleFullscreenLayout = () => {
    player.classList.remove('video-fullscreen-pending');
    updateVideoLayout();
    if (!playerIsFullscreen(player)) restoreFullscreenReturnState(player);
    showControls();
  };
  player.addEventListener('fullscreenchange', handleFullscreenLayout);
  player.addEventListener('webkitfullscreenchange', handleFullscreenLayout);
  if ('ResizeObserver' in window) new ResizeObserver(updateVideoLayout).observe(player);
  if (video.error) showPlaybackError();
});

window.addEventListener('popstate', () => {
  const fullscreenPlayer = document.fullscreenElement || document.webkitFullscreenElement;
  const fullscreenReturnState = fullscreenPlayer && fullscreenReturnStates.get(fullscreenPlayer);
  if (fullscreenReturnState) {
    // Some browsers send Back through history before leaving native fullscreen.
    // Restore that entry before asking the browser to exit fullscreen.
    try {
      history.pushState(fullscreenReturnState.historyState, '', fullscreenReturnState.url);
    } catch { /* Continue with fullscreen exit if history restoration is blocked. */ }
    Promise.resolve(exitPlayerFullscreen(fullscreenPlayer)).catch(() => {});
    return;
  }
  document.querySelectorAll('.video-player.video-fullscreen-fallback').forEach((player) => {
    if (fullscreenReturnStates.has(player)) restoreFullscreenReturnState(player);
    else {
      releasePlayerOrientation(player);
      player.classList.remove('video-fullscreen-fallback');
      const viewport = player.querySelector('.video-viewport');
      if (viewport) {
        viewport.style.width = '';
        viewport.style.height = '';
      }
    }
  });
  setFullscreenIcons();
});

const handleDocumentFullscreenChange = () => {
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fullscreenElement) {
    videoPlayers.forEach((player) => {
      if (fullscreenReturnStates.has(player)) restoreFullscreenReturnState(player);
      else if (orientationLockStates.has(player)) releasePlayerOrientation(player);
    });
  }
  setFullscreenIcons();
};

setFullscreenIcons();
document.addEventListener('fullscreenchange', handleDocumentFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleDocumentFullscreenChange);
window.addEventListener('pagehide', () => videoPlayers.forEach((player) => window.clearTimeout(player._videoHideTimer)));
