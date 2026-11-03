/**
 * discovery.js
 * ─────────────────────────────────────────────────────────────────────────
 * Auto-descubrimiento de pistas y subtítulos.
 *
 * ESTRATEGIA:
 *   - Local (localhost / 127.0.0.1) → directory listing de `serve`
 *   - Cualquier otro hosting (Vercel, GitHub Pages, Netlify…)
 *     → GitHub Contents API usando CONFIG.github
 *
 * CONVENCIÓN DE NOMBRES:
 *   tracks/gloria a dios.mp3  →  vtt/gloria a dios.vtt
 *
 * PARSEO DE TÍTULO DESDE NOMBRE:
 *   "Artista - Titulo.mp3"  →  artist: "Artista", title: "Titulo"
 *   "titulo.mp3"            →  artist: "",         title: "Titulo"
 * ─────────────────────────────────────────────────────────────────────────
 */

import { CONFIG } from './config.js';

const Discovery = (() => {

  const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac', '.opus'];

  // ─── Punto de entrada ─────────────────────────────────────────────────
  async function discoverTracks() {
    const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

    let audioFiles = [];

    try {
      if (isLocal) {
        console.info('[Discovery] Modo local → directory listing');
        audioFiles = await _discoverFromDirectoryListing();
      } else {
        console.info('[Discovery] Modo remoto → GitHub API');
        audioFiles = await _discoverFromGitHubAPI();
      }
    } catch (err) {
      console.warn('[Discovery] Error en descubrimiento:', err);
      audioFiles = [];
    }

    if (!audioFiles.length) {
      console.info('[Discovery] No se encontraron archivos de audio.');
      return [];
    }

    const tracks = await _buildTrackList(audioFiles);
    console.info(`[Discovery] ${tracks.length} pista(s) encontrada(s).`);
    return tracks;
  }

  // ─── GitHub Contents API ──────────────────────────────────────────────
  async function _discoverFromGitHubAPI() {
    const { owner, repo } = CONFIG.github;

    if (!owner || !repo) {
      throw new Error('Falta CONFIG.github.owner o CONFIG.github.repo en config.js');
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/tracks`;
    console.info(`[Discovery] Consultando: ${url}`);

    const res = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (res.status === 403) {
      const reset = res.headers.get('X-RateLimit-Reset');
      const resetTime = reset ? new Date(parseInt(reset) * 1000).toLocaleTimeString() : 'desconocido';
      throw new Error(`GitHub API rate limit alcanzado. Se restablece a las ${resetTime}.`);
    }

    if (!res.ok) {
      throw new Error(`GitHub API devolvió ${res.status}. Verifica owner/repo en config.js`);
    }

    const files = await res.json();

    if (!Array.isArray(files)) {
      throw new Error('La respuesta de GitHub API no es un array. ¿Existe la carpeta tracks/?');
    }

    return files
      .filter(f => f.type === 'file' && _isAudio(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      .map(f => ({
        name:    f.name,
        src:     _buildAssetURL('tracks', f.name),
        vttPath: _buildAssetURL('vtt', _stripExt(f.name) + '.vtt')
      }));
  }

  // ─── Directory listing local ──────────────────────────────────────────
  async function _discoverFromDirectoryListing() {
    const res = await fetch('./tracks/');
    if (!res.ok) throw new Error(`No accesible tracks/ (HTTP ${res.status})`);

    const html   = await res.text();
    const parser = new DOMParser();
    const doc    = parser.parseFromString(html, 'text/html');

    return [...doc.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href').split('/').pop())
      .filter(name => name && _isAudio(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map(name => ({
        name,
        src:     `./tracks/${name}`,
        vttPath: `./vtt/${_stripExt(name)}.vtt`
      }));
  }

  // ─── Construir URL del asset según el hosting ─────────────────────────
  function _buildAssetURL(folder, filename) {
    // Codifica el nombre para URLs (maneja espacios, caracteres especiales)
    const encoded = filename.split('/').map(encodeURIComponent).join('/');

    // En GitHub Pages el path tiene el repo como prefijo
    const isGitHubPages = window.location.hostname.endsWith('github.io');
    if (isGitHubPages) {
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const base      = pathParts.length > 0 ? '/' + pathParts[0] : '';
      return `${base}/${folder}/${encoded}`;
    }

    // Vercel, Netlify y cualquier otro hosting estático
    return `./${folder}/${encoded}`;
  }

  // ─── Verificar VTTs y construir lista final ───────────────────────────
  async function _buildTrackList(audioFiles) {
    // Verificar existencia de VTTs en paralelo (HEAD requests)
    const vttChecks = await Promise.all(
      audioFiles.map(async file => {
        try {
          const res = await fetch(file.vttPath, { method: 'HEAD' });
          return res.ok;
        } catch {
          return false;
        }
      })
    );

    return audioFiles.map((file, i) => {
      const { title, artist } = _parseMeta(_stripExt(file.name));
      return {
        title,
        artist,
        src:   file.src,
        vtt:   vttChecks[i] ? file.vttPath : null,
        cover: null
      };
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  function _parseMeta(nameWithoutExt) {
    // "Artista - Título" → separar por primer " - "
    const match = nameWithoutExt.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (match) {
      return {
        artist: _humanize(match[1].trim()),
        title:  _humanize(match[2].trim())
      };
    }
    return { artist: '', title: _humanize(nameWithoutExt) };
  }

  function _humanize(str) {
    return str
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  function _stripExt(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }

  function _isAudio(filename) {
    const lower = filename.toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
  }

  return { discoverTracks };
})();

export default Discovery;
