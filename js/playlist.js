/**
 * playlist.js
 * Gestiona la lista de reproducción:
 * - Recibe el array de tracks (descubierto por discovery.js)
 * - Renderiza los ítems dinámicamente
 * - Maneja selección, estado activo y navegación
 * - Notifica al player cuando cambia la pista
 */

const PlaylistManager = (() => {
  // ─── Referencias DOM ───────────────────────────────────────────────────
  let _listEl    = null;   // <ul class="playlist__list">
  let _countEl   = null;   // .playlist__count
  let _onSelect  = null;   // Callback(track, idx) cuando se selecciona pista

  // ─── Estado ────────────────────────────────────────────────────────────
  let _tracks     = [];
  let _currentIdx = 0;
  let _itemEls    = [];

  // ─── Inicialización ────────────────────────────────────────────────────
  function init({ listEl, countEl, onSelect }) {
    _listEl   = listEl;
    _countEl  = countEl;
    _onSelect = onSelect;
  }

  /**
   * load(tracks)
   * Recibe el array de pistas ya descubiertas y renderiza la lista.
   */
  function load(tracks) {
    _tracks     = tracks;
    _currentIdx = 0;
    _itemEls    = [];
    _render();
  }

  // ─── Renderizado ──────────────────────────────────────────────────────
  function _render() {
    _listEl.innerHTML = '';

    if (_countEl) {
      _countEl.textContent = `${_tracks.length} pista${_tracks.length !== 1 ? 's' : ''}`;
    }

    if (!_tracks.length) {
      _listEl.innerHTML = `
        <li class="playlist__empty-msg" style="
          padding: 2rem 1.5rem;
          text-align: center;
          color: var(--color-text-muted);
          font-size: var(--font-size-sm);
          line-height: 1.6;
        ">
          <div style="font-size:2rem; margin-bottom:.75rem;">📂</div>
          No se encontraron audios en <code>tracks/</code>.<br>
          Sube archivos .mp3 o .ogg para verlos aquí.
        </li>`;
      return;
    }

    _tracks.forEach((track, idx) => {
      const li = document.createElement('li');
      li.className = 'playlist__item';
      li.setAttribute('role', 'option');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-selected', 'false');
      li.setAttribute('aria-label', `${track.title}${track.artist ? ' de ' + track.artist : ''}`);
      li.dataset.index = idx;

      // Cobertura: placeholder o imagen
      const coverHTML = track.cover
        ? `<img class="playlist__item-cover-image" src="${track.cover}" alt="Portada ${_esc(track.title)}" loading="lazy">`
        : `<span class="playlist__item-cover-placeholder" aria-hidden="true">🎵</span>`;

      // Badge VTT
      const vttBadge = track.vtt
        ? `<span class="playlist__item-vtt" title="Letras disponibles" aria-label="Tiene letras">🎤</span>`
        : '';

      li.innerHTML = `
        <div class="playlist__item-cover" aria-hidden="true">
          ${coverHTML}
          <div class="playlist__item-cover-overlay" aria-hidden="true">
            <div class="playlist__equalizer">
              <div class="playlist__equalizer-bar"></div>
              <div class="playlist__equalizer-bar"></div>
              <div class="playlist__equalizer-bar"></div>
              <div class="playlist__equalizer-bar"></div>
            </div>
          </div>
        </div>
        <div class="playlist__item-meta">
          <span class="playlist__item-name">${_esc(track.title)}</span>
          <span class="playlist__item-artist">
            ${track.artist ? _esc(track.artist) : '<em style="opacity:.5">Artista desconocido</em>'}
            ${vttBadge}
          </span>
        </div>
        <span class="playlist__item-duration" data-idx="${idx}">--:--</span>
      `;

      li.addEventListener('click', () => _selectByIndex(idx));
      li.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _selectByIndex(idx);
        }
      });

      _listEl.appendChild(li);
      _itemEls.push(li);
    });

    // Pre-cargar duraciones en background
    _loadDurations();
  }

  // ─── Selección ────────────────────────────────────────────────────────
  function _selectByIndex(idx) {
    if (idx < 0 || idx >= _tracks.length) return;
    _currentIdx = idx;
    _updateActiveUI();
    if (_onSelect) _onSelect(_tracks[idx], idx);
  }

  function _updateActiveUI() {
    _itemEls.forEach((el, i) => {
      const isActive = i === _currentIdx;
      el.classList.toggle('playlist__item--active', isActive);
      el.setAttribute('aria-selected', String(isActive));
    });
  }

  // ─── Estado de reproducción (controla ecualizador animado) ────────────
  function setPlayState(playing) {
    const activeEl = _itemEls[_currentIdx];
    if (!activeEl) return;
    activeEl.classList.toggle('playlist__item--paused', !playing);
  }

  // ─── Pre-carga de duraciones ──────────────────────────────────────────
  function _loadDurations() {
    _tracks.forEach((track, idx) => {
      if (!track.src) return;
      const tmp    = new Audio();
      tmp.preload  = 'metadata';
      tmp.addEventListener('loadedmetadata', () => {
        const el = _listEl.querySelector(`[data-idx="${idx}"]`);
        if (el) el.textContent = _fmt(tmp.duration);
      });
      tmp.addEventListener('error', () => {
        const el = _listEl.querySelector(`[data-idx="${idx}"]`);
        if (el) el.textContent = '⚠';
      });
      tmp.src = track.src;
    });
  }

  // ─── Navegación pública ───────────────────────────────────────────────
  function next() {
    _selectByIndex((_currentIdx + 1) % _tracks.length);
  }

  function prev() {
    _selectByIndex((_currentIdx - 1 + _tracks.length) % _tracks.length);
  }

  function selectFirst() {
    _selectByIndex(0);
  }

  function getCurrentIndex() { return _currentIdx; }
  function getTracks()       { return _tracks; }
  function getCount()        { return _tracks.length; }

  // ─── Helpers ──────────────────────────────────────────────────────────
  function _fmt(secs) {
    if (!isFinite(secs) || isNaN(secs)) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── API pública ──────────────────────────────────────────────────────
  return { init, load, next, prev, selectFirst, getCurrentIndex, getTracks, getCount, setPlayState };
})();

export default PlaylistManager;
