/**
 * player.js
 * ─────────────────────────────────────────────────────────────────────────
 * Motor principal del reproductor.
 * Ya NO contiene un array TRACKS hardcodeado.
 * Las pistas se descubren automáticamente desde:
 *   - tracks/   → archivos de audio (.mp3, .ogg, etc.)
 *   - vtt/      → subtítulos WebVTT (mismo nombre, extensión .vtt)
 *
 * Funciona tanto en local (npx serve) como en GitHub Pages.
 * ─────────────────────────────────────────────────────────────────────────
 */

import Discovery       from './discovery.js';
import SubtitleEngine  from './subtitles.js';
import PlaylistManager from './playlist.js';

// ══════════════════════════════════════════════════════════════════════════
// MOTOR DEL REPRODUCTOR
// ══════════════════════════════════════════════════════════════════════════
const Player = (() => {

  // ─── Elemento de audio ──────────────────────────────────────────────────
  const audio = new Audio();
  audio.preload = 'metadata';

  // ─── Estado ─────────────────────────────────────────────────────────────
  let _currentTrack = null;
  let _isPlaying    = false;
  let _repeatMode   = 'none';  // 'none' | 'one' | 'all'
  let _isShuffle    = false;

  // ─── Referencias DOM ─────────────────────────────────────────────────────
  let $coverImg, $coverPlaceholder, $coverZone;
  let $trackTitle, $trackArtist;
  let $progressFill, $progressThumb, $progressTrack;
  let $timeElapsed, $timeDuration;
  let $btnPlay, $btnPrev, $btnNext, $btnShuffle, $btnRepeat;
  let $volumeSlider, $volumeIcon;
  let $loadingScreen;

  // ─── Inicialización ──────────────────────────────────────────────────────
  async function init() {
    _captureDOMRefs();
    _bindControlEvents();

    // Inicializar sub-módulos con sus refs DOM
    SubtitleEngine.init({
      audio,
      lyricsBody:      document.getElementById('lyrics-body'),
      lyricsLines:     document.getElementById('lyrics-lines'),
      lyricsEmpty:     document.getElementById('lyrics-empty'),
      headerTrackName: document.getElementById('lyrics-track-name'),
      waveform:        document.getElementById('lyrics-waveform')
    });

    PlaylistManager.init({
      listEl:   document.getElementById('playlist-list'),
      countEl:  document.getElementById('playlist-count'),
      onSelect: (track) => loadTrack(track, true)
    });

    // Volumen inicial
    audio.volume = parseFloat($volumeSlider.value);

    // ─── Auto-descubrimiento de pistas ─────────────────────────────────
    _showLoading(true);

    const tracks = await Discovery.discoverTracks();

    _showLoading(false);
    PlaylistManager.load(tracks);

    if (tracks.length > 0) {
      // Cargar la primera pista sin reproducir aún
      loadTrack(tracks[0], false);
      PlaylistManager.selectFirst();
    }

    // Eventos de audio
    _bindAudioEvents();
  }

  // ─── Cargar una pista ────────────────────────────────────────────────────
  function loadTrack(track, autoPlay = false) {
    _currentTrack = track;
    SubtitleEngine.reset();

    // Actualizar info
    $trackTitle.textContent  = track.title  || 'Sin título';
    $trackArtist.textContent = track.artist || 'Artista desconocido';

    // Portada
    if (track.cover) {
      $coverImg.src                  = track.cover;
      $coverImg.style.display        = 'block';
      $coverPlaceholder.style.display = 'none';
    } else {
      $coverImg.style.display         = 'none';
      $coverPlaceholder.style.display = 'flex';
    }

    // Title del documento
    document.title = `${track.title}${track.artist ? ' · ' + track.artist : ''} | Mi Reproductor`;

    // Cargar audio
    if (track.src) {
      audio.src = track.src;
      audio.load();
    } else {
      audio.removeAttribute('src');
      $timeDuration.textContent = '--:--';
      $timeElapsed.textContent  = '00:00';
      _setProgress(0);
    }

    // Cargar subtítulos
    SubtitleEngine.load(track.vtt, track.title);

    _setProgress(0);

    if (autoPlay && track.src) {
      audio.play().catch(() => _setPlayingState(false));
    } else {
      _setPlayingState(false);
    }
  }

  // ─── Eventos de audio ────────────────────────────────────────────────────
  function _bindAudioEvents() {
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      _setProgress(pct);
      $timeElapsed.textContent = _fmt(audio.currentTime);
      // Actualizar aria-valuenow en el slider
      $progressTrack.setAttribute('aria-valuenow', Math.round(pct));
      SubtitleEngine.sync(audio.currentTime);
    });

    audio.addEventListener('loadedmetadata', () => {
      $timeDuration.textContent = _fmt(audio.duration);
    });

    audio.addEventListener('play',  () => _setPlayingState(true));
    audio.addEventListener('pause', () => _setPlayingState(false));

    audio.addEventListener('ended', _onTrackEnded);

    audio.addEventListener('error', () => {
      console.error('[Player] Error al cargar el audio:', audio.src);
      _setPlayingState(false);
    });
  }

  // ─── Eventos de controles ────────────────────────────────────────────────
  function _bindControlEvents() {
    $btnPlay.addEventListener('click', () => {
      if (!_currentTrack?.src) return;
      audio.paused ? audio.play() : audio.pause();
    });

    $btnPrev.addEventListener('click', () => {
      if (audio.currentTime > 3) {
        audio.currentTime = 0;
      } else {
        PlaylistManager.prev();
      }
    });

    $btnNext.addEventListener('click', () => PlaylistManager.next());

    $btnShuffle.addEventListener('click', () => {
      _isShuffle = !_isShuffle;
      $btnShuffle.classList.toggle('player__btn--active', _isShuffle);
      $btnShuffle.setAttribute('aria-pressed', String(_isShuffle));
      $btnShuffle.title = _isShuffle ? 'Aleatorio activado' : 'Aleatorio desactivado';
    });

    $btnRepeat.addEventListener('click', () => {
      const modes = ['none', 'all', 'one'];
      _repeatMode = modes[(modes.indexOf(_repeatMode) + 1) % modes.length];
      _updateRepeatUI();
    });

    // Progress bar — click y drag
    let _isDragging = false;

    $progressTrack.addEventListener('click', e => {
      if (!audio.duration || !_currentTrack?.src) return;
      _seekFromEvent(e);
    });

    $progressTrack.addEventListener('mousedown', () => { _isDragging = true; });
    document.addEventListener('mousemove', e => { if (_isDragging) _seekFromEvent(e); });
    document.addEventListener('mouseup',   () => { _isDragging = false; });

    // Touch seek
    $progressTrack.addEventListener('touchstart', e => _seekFromTouch(e.touches[0]), { passive: true });
    $progressTrack.addEventListener('touchmove',  e => {
      e.preventDefault();
      _seekFromTouch(e.touches[0]);
    }, { passive: false });

    // Volumen
    $volumeSlider.addEventListener('input', () => {
      audio.volume = parseFloat($volumeSlider.value);
      _updateVolumeIcon();
    });

    // Keyboard shortcuts globales
    document.addEventListener('keydown', e => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      switch (e.key) {
        case ' ':        e.preventDefault(); $btnPlay.click(); break;
        case 'ArrowRight': if (audio.duration) audio.currentTime = Math.min(audio.currentTime + 5, audio.duration); break;
        case 'ArrowLeft':  audio.currentTime = Math.max(audio.currentTime - 5, 0); break;
        case 'ArrowUp':
          $volumeSlider.value = Math.min(parseFloat($volumeSlider.value) + 0.1, 1).toFixed(2);
          audio.volume = parseFloat($volumeSlider.value);
          _updateVolumeIcon();
          break;
        case 'ArrowDown':
          $volumeSlider.value = Math.max(parseFloat($volumeSlider.value) - 0.1, 0).toFixed(2);
          audio.volume = parseFloat($volumeSlider.value);
          _updateVolumeIcon();
          break;
        case 'n': case 'N': $btnNext.click(); break;
        case 'p': case 'P': $btnPrev.click(); break;
      }
    });
  }

  // ─── Fin de pista ────────────────────────────────────────────────────────
  function _onTrackEnded() {
    if (_repeatMode === 'one') {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    const idx   = PlaylistManager.getCurrentIndex();
    const total = PlaylistManager.getCount();

    if (idx < total - 1) {
      PlaylistManager.next();
    } else if (_repeatMode === 'all') {
      PlaylistManager.selectFirst();
    } else {
      _setPlayingState(false);
      _setProgress(0);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function _captureDOMRefs() {
    $coverImg           = document.getElementById('player-cover-img');
    $coverPlaceholder   = document.getElementById('player-cover-placeholder');
    $coverZone          = document.getElementById('player-cover');
    $trackTitle         = document.getElementById('player-track-title');
    $trackArtist        = document.getElementById('player-track-artist');
    $progressFill       = document.getElementById('player-progress-fill');
    $progressThumb      = document.getElementById('player-progress-thumb');
    $progressTrack      = document.getElementById('player-progress-track');
    $timeElapsed        = document.getElementById('player-time-elapsed');
    $timeDuration       = document.getElementById('player-time-duration');
    $btnPlay            = document.getElementById('btn-play');
    $btnPrev            = document.getElementById('btn-prev');
    $btnNext            = document.getElementById('btn-next');
    $btnShuffle         = document.getElementById('btn-shuffle');
    $btnRepeat          = document.getElementById('btn-repeat');
    $volumeSlider       = document.getElementById('volume-slider');
    $volumeIcon         = document.getElementById('volume-icon');
    $loadingScreen      = document.getElementById('loading-screen');
  }

  function _setPlayingState(playing) {
    _isPlaying = playing;

    $btnPlay.innerHTML = playing
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
           <rect x="6" y="4" width="4" height="16" rx="1"/>
           <rect x="14" y="4" width="4" height="16" rx="1"/>
         </svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
           <path d="M8 5v14l11-7z"/>
         </svg>`;

    $btnPlay.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    $coverZone?.classList.toggle('player__cover--playing', playing);

    document.getElementById('lyrics-waveform')
      ?.classList.toggle('lyrics__waveform--playing', playing);

    PlaylistManager.setPlayState(playing);
  }

  function _setProgress(pct) {
    if ($progressFill)  $progressFill.style.width = `${pct}%`;
    if ($progressThumb) $progressThumb.style.left = `${pct}%`;
  }

  function _seekFromEvent(e) {
    const rect = $progressTrack.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) {
      audio.currentTime = pct * audio.duration;
      _setProgress(pct * 100);
    }
  }

  function _seekFromTouch(touch) {
    const rect = $progressTrack.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    if (audio.duration) {
      audio.currentTime = pct * audio.duration;
      _setProgress(pct * 100);
    }
  }

  function _updateVolumeIcon() {
    const vol = parseFloat($volumeSlider.value);
    $volumeIcon.textContent = vol === 0 ? '🔇' : vol < 0.5 ? '🔉' : '🔊';
  }

  function _updateRepeatUI() {
    const icons  = { none: '🔁', all: '🔁', one: '🔂' };
    const labels = {
      none: 'Repetir desactivado',
      all:  'Repetir todo',
      one:  'Repetir una pista'
    };
    $btnRepeat.querySelector('span').textContent = icons[_repeatMode];
    $btnRepeat.classList.toggle('player__btn--active', _repeatMode !== 'none');
    $btnRepeat.setAttribute('aria-label', labels[_repeatMode]);
    $btnRepeat.title = labels[_repeatMode];
  }

  function _showLoading(show) {
    if (!$loadingScreen) return;
    $loadingScreen.style.display = show ? 'flex' : 'none';
  }

  function _fmt(secs) {
    if (!isFinite(secs) || isNaN(secs)) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ─── API pública ──────────────────────────────────────────────────────────
  return { init };
})();

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => Player.init());
