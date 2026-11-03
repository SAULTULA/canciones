/**
 * subtitles.js
 * Motor de sincronización WebVTT.
 * Usa el API nativa <track> del navegador (TextTrack + cuechange)
 * para detectar la línea activa sin necesidad de parsear el VTT manualmente.
 *
 * También renderiza TODAS las líneas en modo "letras completas"
 * con estados: past, active, future.
 */

const SubtitleEngine = (() => {
  // ─── Referencias DOM ───────────────────────────────────────────────────
  let _lyricsBody       = null;  // .lyrics__body
  let _lyricsLines      = null;  // .lyrics__lines
  let _lyricsEmpty      = null;  // .lyrics__empty
  let _headerTrackName  = null;  // .lyrics__header-track-name
  let _waveform         = null;  // .lyrics__waveform

  // ─── Estado interno ────────────────────────────────────────────────────
  let _audio      = null;  // HTMLAudioElement
  let _track      = null;  // HTMLTrackElement (oculto)
  let _cues       = [];    // Array de {start, end, text, el} renderizados
  let _activeIdx  = -1;

  // ─── Inicialización ────────────────────────────────────────────────────
  function init({ audio, lyricsBody, lyricsLines, lyricsEmpty, headerTrackName, waveform }) {
    _audio           = audio;
    _lyricsBody      = lyricsBody;
    _lyricsLines     = lyricsLines;
    _lyricsEmpty     = lyricsEmpty;
    _headerTrackName = headerTrackName;
    _waveform        = waveform;
  }

  /**
   * load(vttUrl, trackTitle)
   * Carga un archivo VTT y renderiza todas las líneas.
   * Usa fetch + parse manual para el modo "letras completas".
   */
  function load(vttUrl, trackTitle = '') {
    // Limpiar estado anterior
    _cues      = [];
    _activeIdx = -1;
    _lyricsLines.innerHTML  = '';
    _lyricsEmpty.style.display = 'none';
    _lyricsLines.style.display = 'flex';

    if (_headerTrackName) {
      _headerTrackName.textContent = trackTitle;
    }

    if (!vttUrl) {
      _showEmpty('Sin subtítulos disponibles para esta pista.');
      return;
    }

    fetch(vttUrl)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(raw => {
        const parsed = _parseVTT(raw);
        if (!parsed.length) {
          _showEmpty('El archivo de subtítulos está vacío.');
          return;
        }
        _cues = parsed;
        _renderAllLines();
      })
      .catch(err => {
        console.warn('[SubtitleEngine] Error cargando VTT:', err);
        _showEmpty('No se pudo cargar el archivo de subtítulos.');
      });
  }

  /**
   * sync(currentTime)
   * Llama en cada timeupdate del audio.
   * Determina qué línea está activa y aplica las clases BEM.
   */
  function sync(currentTime) {
    if (!_cues.length) return;

    let newActiveIdx = -1;

    for (let i = 0; i < _cues.length; i++) {
      const cue = _cues[i];
      if (currentTime >= cue.start && currentTime < cue.end) {
        newActiveIdx = i;
        break;
      }
    }

    if (newActiveIdx === _activeIdx) return; // Sin cambio
    _activeIdx = newActiveIdx;

    _cues.forEach((cue, i) => {
      const el = cue.el;
      if (!el) return;
      el.classList.remove(
        'lyrics__line--active',
        'lyrics__line--past',
        'lyrics__line--future'
      );

      if (i === _activeIdx) {
        el.classList.add('lyrics__line--active');
        // Auto-scroll a la línea activa
        _scrollToLine(el);
      } else if (_activeIdx !== -1 && i < _activeIdx) {
        el.classList.add('lyrics__line--past');
      } else {
        el.classList.add('lyrics__line--future');
      }
    });
  }

  /**
   * reset()
   * Limpia todos los estados (al cargar nueva pista).
   */
  function reset() {
    _activeIdx = -1;
    _cues.forEach(cue => {
      if (cue.el) {
        cue.el.classList.remove(
          'lyrics__line--active',
          'lyrics__line--past',
          'lyrics__line--future'
        );
      }
    });
  }

  // ─── Helpers privados ──────────────────────────────────────────────────

  function _parseVTT(raw) {
    const lines   = raw.split('\n');
    const result  = [];
    let i         = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Detecta línea de tiempo: "00:00:02.000 --> 00:00:05.500"
      const timingMatch = line.match(
        /^(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/
      );

      if (timingMatch) {
        const start = _parseTime(timingMatch[1]);
        const end   = _parseTime(timingMatch[2]);

        // Recopilar texto (líneas siguientes hasta vacía)
        const textLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '') {
          const t = lines[i].trim();
          if (!t.startsWith('NOTE')) textLines.push(t);
          i++;
        }

        const text = textLines.join('\n');
        if (text && !text.startsWith('NOTE')) {
          result.push({ start, end, text, el: null });
        }
      } else {
        i++;
      }
    }

    return result;
  }

  function _parseTime(str) {
    // Soporta HH:MM:SS.mmm y HH:MM:SS,mmm
    const clean = str.replace(',', '.');
    const parts = clean.split(':');
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    return h * 3600 + m * 60 + s;
  }

  function _renderAllLines() {
    _lyricsLines.innerHTML = '';

    _cues.forEach((cue, i) => {
      const el = document.createElement('p');
      el.className = 'lyrics__line lyrics__line--future';
      el.textContent = cue.text;

      // Click en la línea → seek al tiempo de esa cue
      el.addEventListener('click', () => {
        if (_audio) {
          _audio.currentTime = cue.start + 0.05;
          if (_audio.paused) _audio.play();
        }
      });

      cue.el = el;
      _lyricsLines.appendChild(el);
    });
  }

  function _scrollToLine(el) {
    if (!el || !_lyricsBody) return;
    const containerTop    = _lyricsBody.scrollTop;
    const containerBottom = containerTop + _lyricsBody.clientHeight;
    const elTop           = el.offsetTop;
    const elBottom        = elTop + el.offsetHeight;

    if (elTop < containerTop || elBottom > containerBottom) {
      _lyricsBody.scrollTo({
        top: elTop - _lyricsBody.clientHeight / 2 + el.offsetHeight / 2,
        behavior: 'smooth'
      });
    }
  }

  function _showEmpty(msg) {
    _lyricsLines.style.display = 'none';
    _lyricsEmpty.style.display = 'flex';
    const textEl = _lyricsEmpty.querySelector('.lyrics__empty-text');
    if (textEl) textEl.textContent = msg;
  }

  // ─── API pública ───────────────────────────────────────────────────────
  return { init, load, sync, reset };
})();

export default SubtitleEngine;
