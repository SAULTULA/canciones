/**
 * discovery.js
 * ─────────────────────────────────────────────────────────────────────────
 * Auto-descubrimiento de pistas y subtítulos.
 *
 * ESTRATEGIA:
 *   1. GitHub Pages  → GitHub Contents API (sin autenticación, 60 req/h)
 *   2. Local (serve) → Parseo del HTML de directory listing
 *
 * CONVENCIÓN DE NOMBRES:
 *   tracks/mi-cancion.mp3  →  vtt/mi-cancion.vtt
 *   (mismo nombre de archivo, diferente extensión y carpeta)
 *
 * FORMATO DE TÍTULO DESDE NOMBRE DE ARCHIVO:
 *   "artista - nombre cancion.mp3"  →  title: "Nombre Cancion", artist: "Artista"
 *   "nombre cancion.mp3"            →  title: "Nombre Cancion", artist: ""
 * ─────────────────────────────────────────────────────────────────────────
 */

const Discovery = (() => {

  // Extensiones de audio soportadas
  const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac', '.opus'];

  // ─── Punto de entrada público ─────────────────────────────────────────
  async function discoverTracks() {
    let audioFiles = [];

    try {
      if (_isGitHubPages()) {
        audioFiles = await _discoverFromGitHubAPI();
      } else {
        audioFiles = await _discoverFromDirectoryListing();
      }
    } catch (err) {
      console.warn('[Discovery] Error en auto-descubrimiento:', err);
      audioFiles = [];
    }

    if (!audioFiles.length) {
      console.info('[Discovery] No se encontraron archivos de audio en tracks/');
      return [];
    }

    // Para cada audio, verificar si existe su VTT correspondiente
    const tracks = await _buildTrackList(audioFiles);
    console.info(`[Discovery] ${tracks.length} pista(s) encontrada(s).`);
    return tracks;
  }

  // ─── Detección de entorno ─────────────────────────────────────────────
  function _isGitHubPages() {
    return window.location.hostname.endsWith('github.io');
  }

  // ─── Estrategia 1: GitHub Contents API ───────────────────────────────
  async function _discoverFromGitHubAPI() {
    const { owner, repo, basePath } = _parseGitHubPagesURL();
    console.info(`[Discovery] GitHub Pages detectado → owner: ${owner}, repo: ${repo}`);

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const tracksPath = basePath ? `${basePath}/tracks` : 'tracks';

    const res = await fetch(`${apiBase}/${tracksPath}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
    }

    const files = await res.json();

    return files
      .filter(f => f.type === 'file' && _isAudioFile(f.name))
      .map(f => ({
        name:     f.name,
        src:      `${_getBasePath()}/tracks/${f.name}`,
        vttPath:  `${_getBasePath()}/vtt/${_stripExtension(f.name)}.vtt`
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  function _parseGitHubPagesURL() {
    const hostname  = window.location.hostname;          // user.github.io
    const owner     = hostname.replace('.github.io', '');
    const pathParts = window.location.pathname           // /repo/ o /
      .split('/')
      .filter(Boolean);
    const repo      = pathParts[0] || owner + '.github.io';
    const basePath  = pathParts.slice(1).join('/');      // sub-ruta si existe
    return { owner, repo, basePath };
  }

  function _getBasePath() {
    // Retorna la base URL relativa al index.html
    // En GitHub Pages: /repo — en raíz: ''
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (_isGitHubPages() && parts.length > 0) {
      return '/' + parts[0];
    }
    return '.';
  }

  // ─── Estrategia 2: Directory listing (local con `serve`) ─────────────
  async function _discoverFromDirectoryListing() {
    console.info('[Discovery] Modo local → leyendo directory listing de tracks/');

    const res = await fetch('./tracks/');
    if (!res.ok) throw new Error(`No se puede acceder a tracks/ (HTTP ${res.status})`);

    const html   = await res.text();
    const parser = new DOMParser();
    const doc    = parser.parseFromString(html, 'text/html');
    const links  = [...doc.querySelectorAll('a[href]')];

    const audioFiles = links
      .map(a => {
        // El href puede ser relativo (solo nombre) o absoluto
        const href = a.getAttribute('href');
        // Tomar solo el filename, ignorar "../" y paths absolutos
        const name = href.split('/').pop();
        return name;
      })
      .filter(name => name && _isAudioFile(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(name => ({
        name,
        src:     `./tracks/${name}`,
        vttPath: `./vtt/${_stripExtension(name)}.vtt`
      }));

    return audioFiles;
  }

  // ─── Construcción de la lista final ──────────────────────────────────
  async function _buildTrackList(audioFiles) {
    const tracks = [];

    // Verificar VTTs en paralelo (HEAD requests)
    const vttChecks = audioFiles.map(async file => {
      let hasVtt = false;
      try {
        const res = await fetch(file.vttPath, { method: 'HEAD' });
        hasVtt = res.ok;
      } catch {
        hasVtt = false;
      }
      return hasVtt;
    });

    const vttResults = await Promise.all(vttChecks);

    audioFiles.forEach((file, i) => {
      const nameWithoutExt = _stripExtension(file.name);
      const { title, artist } = _parseTrackMeta(nameWithoutExt);

      tracks.push({
        title,
        artist,
        src:   file.src,
        vtt:   vttResults[i] ? file.vttPath : null,
        cover: null   // reservado para futura detección de covers
      });
    });

    return tracks;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /**
   * Parsea metadatos desde el nombre del archivo.
   * Soporta:
   *   "Artista - Título de la Canción"  → { artist, title }
   *   "Título de la Canción"            → { artist: '', title }
   */
  function _parseTrackMeta(nameWithoutExt) {
    const separatorMatch = nameWithoutExt.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (separatorMatch) {
      return {
        artist: _humanize(separatorMatch[1].trim()),
        title:  _humanize(separatorMatch[2].trim())
      };
    }
    return {
      artist: '',
      title:  _humanize(nameWithoutExt)
    };
  }

  /**
   * Convierte un nombre de archivo en un título legible.
   * "mi-cancion_triste" → "Mi Cancion Triste"
   */
  function _humanize(str) {
    return str
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  function _stripExtension(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }

  function _isAudioFile(filename) {
    const lower = filename.toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
  }

  // ─── API pública ──────────────────────────────────────────────────────
  return { discoverTracks };

})();

export default Discovery;
