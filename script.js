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

  // Garante que videoWidth/videoHeight estejam disponíveis
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

// --- Captura ---
function capture() {
  if (!video.videoWidth) {
    setStatus('Câmera ainda carregando...', 'warn');
    return;
  }

  const w = video.videoWidth;
  const h = video.videoHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Desenha o frame atual do vídeo
  ctx.drawImage(video, 0, 0, w, h);

  // Monta as linhas de metadados
  const lines = [formatDate(new Date())];
  if (currentPosition) {
    lines.push(formatCoord(currentPosition.lat, currentPosition.lng));
    lines.push(`Precisão: ±${Math.round(currentPosition.accuracy)}m`);
  } else {
    lines.push('Localização indisponível');
  }

  // Dimensiona o texto proporcionalmente à imagem
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

  // Exibe o resultado
  preview.src = canvas.toDataURL('image/jpeg', 0.92);
  preview.hidden = false;
  video.hidden = true;
  btnCapture.hidden = true;
  btnDownload.hidden = false;
  btnRetake.hidden = false;
  setStatus('Foto capturada', 'ok');
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