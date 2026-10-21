// --- Elementos ---
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const preview = document.getElementById('preview');
const clock = document.getElementById('clock');
const btnCapture = document.getElementById('btn-capture');
const btnDownload = document.getElementById('btn-download');
const btnRetake = document.getElementById('btn-retake');
const statusEl = document.getElementById('status');

// --- Estado ---
let currentPosition = null;
let stream = null;
let isCapturing = false;

// Cache simples de geocodificação (coordenadas arredondadas → endereço)
const geocodeCache = new Map();

// --- Utils ---
const pad = (n) => String(n).padStart(2, '0');

function formatDate(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatCoord(lat, lng) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lngDir}`;
}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

// --- Câmera ---
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Câmera não suportada neste navegador');
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      throw new Error('Permissão da câmera negada');
    if (err.name === 'NotFoundError')
      throw new Error('Nenhuma câmera encontrada');
    throw new Error('Falha ao acessar câmera: ' + err.message);
  }

  video.srcObject = stream;
  await video.play();

  if (!video.videoWidth) {
    await new Promise((res) =>
      video.addEventListener('loadedmetadata', res, { once: true })
    );
  }
}

// --- Geolocalização ---
function startLocation() {
  if (!navigator.geolocation) {
    setStatus('Pronto (sem GPS)', 'warn');
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      const first = !currentPosition;
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      if (first) setStatus('Pronto para capturar', 'ok');
    },
    (err) => {
      console.warn('Geolocation:', err);
      setStatus('Pronto (sem GPS)', 'warn');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

// --- Relógio ---
function startClock() {
  const tick = () => (clock.textContent = formatDate(new Date()));
  tick();
  setInterval(tick, 1000);
}

// --- Geocodificação reversa (Nominatim / OpenStreetMap) ---
async function obterNomeDaRua(lat, lng) {
  // Chave do cache com ~11m de precisão (suficiente para reutilizar endereço)
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'pt-BR');
   

  // Timeout de 6s para não travar a UI
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
     
    clearTimeout(timeoutId);

    if (response.status === 429) {
      console.warn('Nominatim: limite de requisições atingido.');
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();
    const addr = data.address || {};

    // Prioriza via/pedestre; senão bairro/cidade
    const rua = addr.road || addr.pedestrian || addr.footway || addr.path;
    const bairro = addr.suburb || addr.neighbourhood || addr.city_district;
    const cidade = addr.city || addr.town || addr.village || addr.municipality;

    let resultado = null;
    if (rua) {
      resultado = [rua, bairro, cidade].filter(Boolean).join(', ');
    } else if (data.display_name) {
      // Fallback: pega as 2 primeiras partes do display_name
      resultado = data.display_name.split(',').slice(0, 2).join(',').trim();
    }

    if (resultado) geocodeCache.set(cacheKey, resultado);
    return resultado;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('Geocodificação: timeout');
    } else {
      console.error('Erro na geocodificação reversa:', err);
    }
    return null;
  }
}

// --- Desenho dos metadados no canvas ---
function desenharMetadados(ctx, w, h, lines) {
  const fontSize = Math.max(18, Math.round(w / 42));
  const padding = Math.round(fontSize * 0.7);
  const lineHeight = Math.round(fontSize * 1.35);
  const boxH = lineHeight * lines.length + padding * 2;
  const boxY = h - boxH;

  // Faixa preta semitransparente no rodapé
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, boxY, w, boxH);

  // Texto
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${fontSize}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;

  lines.forEach((line, i) => {
    ctx.fillText(line, padding, boxY + padding + i * lineHeight);
  });
}

// --- Captura ---
async function capture() {
  if (isCapturing) return;
  if (!video.videoWidth) {
    setStatus('Câmera ainda carregando...', 'warn');
    return;
  }

  isCapturing = true;
  btnCapture.disabled = true;

  try {
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // 1) Congela o frame atual imediatamente (preserva o "momento")
    ctx.drawImage(video, 0, 0, w, h);

    // 2) Monta as linhas — data/hora agora
    const lines = [formatDate(new Date())];

    // 3) Resolve o endereço (com fallback para coordenadas)
    if (currentPosition) {
      setStatus('Obtendo endereço...', 'warn');
      const nomeRua = await obterNomeDaRua(
        currentPosition.lat,
        currentPosition.lng
      );

      if (nomeRua) {
        lines.push(nomeRua);
      } else {
        // Fallback: coordenadas cruas
        lines.push(formatCoord(currentPosition.lat, currentPosition.lng));
        lines.push('(endereço indisponível)');
      }
    } else {
      lines.push('Localização indisponível');
    }

    // 4) Desenha os metadados sobre o frame já congelado
    desenharMetadados(ctx, w, h, lines);

    // 5) Exibe o resultado
    preview.src = canvas.toDataURL('image/jpeg', 0.92);
    preview.hidden = false;
    video.hidden = true;
    btnCapture.hidden = true;
    btnDownload.hidden = false;
    btnRetake.hidden = false;
    setStatus('Foto capturada', 'ok');
  } catch (err) {
    console.error('Erro na captura:', err);
    setStatus('Falha ao capturar', 'error');
  } finally {
    isCapturing = false;
    btnCapture.disabled = false;
  }
}

// --- Download ---
function download() {
  const now = new Date();
  const name = `timestamp_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_` +
               `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;
  const a = document.createElement('a');
  a.href = preview.src;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- Retake ---
function retake() {
  preview.hidden = true;
  video.hidden = false;
  btnDownload.hidden = true;
  btnRetake.hidden = true;
  btnCapture.hidden = false;
  setStatus('Pronto para capturar', 'ok');
}

// --- Init ---
async function init() {
  startClock();
  setStatus('Iniciando câmera...');
  try {
    await startCamera();
    btnCapture.disabled = false;
    setStatus('Obtendo localização...');
    startLocation();
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

btnCapture.addEventListener('click', capture);
btnDownload.addEventListener('click', download);
btnRetake.addEventListener('click', retake);

init();
