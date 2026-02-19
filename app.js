const state = {
  image: null,
  imageWidth: 0,
  imageHeight: 0,
  zoom: 1,
  layers: [],
  activeLayerId: null,
  past: [],
  future: [],
  idSeq: 1,
  directoryHandle: null,
  directoryPath: null,
  directoryName: '',
  currentMaskType: 'mosaic',
  blackDefaults: {
    barCount: 1,
    barGap: 16,
  },
};

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const DEFAULT_STAGE_SIZE = 280;
const THEME_STORAGE_KEY = 'maskingtool-theme';
const desktopBridge =
  typeof window !== 'undefined' && window.desktopApi ? window.desktopApi : null;
const platform =
  (desktopBridge && desktopBridge.platform) ||
  (typeof navigator !== 'undefined' ? navigator.platform : '');

const dom = {
  fileInput: document.getElementById('fileInput'),
  mosaicSize: document.getElementById('mosaicSize'),
  mosaicSizeValue: document.getElementById('mosaicSizeValue'),
  blackBarCount: document.getElementById('blackBarCount'),
  blackGap: document.getElementById('blackGap'),
  tabMosaic: document.getElementById('tabMosaic'),
  tabBlack: document.getElementById('tabBlack'),
  panelMosaic: document.getElementById('panelMosaic'),
  panelBlack: document.getElementById('panelBlack'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  clearMasksBtn: document.getElementById('clearMasksBtn'),
  resetBtn: document.getElementById('resetBtn'),
  exportBtn: document.getElementById('exportBtn'),
  selectFolderBtn: document.getElementById('selectFolderBtn'),
  fileNameInput: document.getElementById('fileNameInput'),
  folderNameInput: document.getElementById('folderNameInput'),
  exportStatus: document.getElementById('exportStatus'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  zoomValue: document.getElementById('zoomValue'),
  stageWrap: document.getElementById('stageWrap'),
  stageViewport: document.getElementById('stageViewport'),
  stage: document.getElementById('stage'),
  baseCanvas: document.getElementById('baseCanvas'),
  overlay: document.getElementById('overlay'),
  selectionBox: document.getElementById('selectionBox'),
};

const baseCtx = dom.baseCanvas.getContext('2d');
const sourceCanvas = document.createElement('canvas');
const sourceCtx = sourceCanvas.getContext('2d');

const dragState = {
  mode: null,
  pointerId: null,
  layerId: null,
  startX: 0,
  startY: 0,
  initialFrame: null,
  draftRect: null,
  beforeGesture: null,
  sliderBeforeGesture: null,
  blackBeforeGesture: null,
  rotateStartAngle: 0,
  initialLayerAngle: 0,
};

function cloneLayers(layers) {
  return layers.map((layer) => ({
    id: layer.id,
    type: layer.type,
    source: layer.source ? { ...layer.source } : null,
    frame: { ...layer.frame },
    blockSize: layer.blockSize,
    barCount: layer.barCount,
    barGap: layer.barGap,
    angle: layer.angle || 0,
  }));
}

function snapshotState() {
  return {
    layers: cloneLayers(state.layers),
    activeLayerId: state.activeLayerId,
    slider: Number(dom.mosaicSize.value),
    maskType: state.currentMaskType,
    blackBarCount: Number(dom.blackBarCount.value),
    blackGap: Number(dom.blackGap.value),
  };
}

function statesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function commitHistory(before) {
  const after = snapshotState();
  if (before && !statesEqual(before, after)) {
    state.past.push(before);
    state.future = [];
  }
  syncButtons();
}

function applySnapshot(snapshot) {
  state.layers = cloneLayers(snapshot.layers);
  state.activeLayerId = snapshot.activeLayerId;

  dom.mosaicSize.value = String(snapshot.slider);
  dom.mosaicSizeValue.textContent = dom.mosaicSize.value;
  dom.blackBarCount.value = String(clamp(snapshot.blackBarCount || 1, 1, 5));
  dom.blackGap.value = String(Math.max(0, snapshot.blackGap || 0));

  setMaskType(snapshot.maskType === 'black' ? 'black' : 'mosaic', { fromSnapshot: true });
  updateBlackGapInputState();
  renderAll();
  syncButtons();
}

function undo() {
  if (!state.past.length) return;
  const current = snapshotState();
  const prev = state.past.pop();
  state.future.push(current);
  applySnapshot(prev);
}

function redo() {
  if (!state.future.length) return;
  const current = snapshotState();
  const next = state.future.pop();
  state.past.push(current);
  applySnapshot(next);
}

function syncButtons() {
  const hasImage = Boolean(state.image);
  const hasLayers = state.layers.length > 0;
  dom.undoBtn.disabled = state.past.length === 0;
  dom.redoBtn.disabled = state.future.length === 0;
  dom.exportBtn.disabled = !hasImage;
  dom.resetBtn.disabled = !hasImage;
  dom.clearMasksBtn.disabled = !hasLayers;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function getStagePoint(event) {
  const rect = dom.stage.getBoundingClientRect();
  const zoom = state.zoom || 1;
  return {
    x: clamp(Math.round((event.clientX - rect.left) / zoom), 0, state.imageWidth),
    y: clamp(Math.round((event.clientY - rect.top) / zoom), 0, state.imageHeight),
  };
}

function normalizeRect(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { x: left, y: top, w: width, h: height };
}

function fitRectToImage(rect) {
  const x = clamp(Math.round(rect.x), 0, Math.max(0, state.imageWidth - 1));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, state.imageHeight - 1));
  const maxW = Math.max(1, state.imageWidth - x);
  const maxH = Math.max(1, state.imageHeight - y);
  const w = clamp(Math.round(rect.w), 1, maxW);
  const h = clamp(Math.round(rect.h), 1, maxH);
  return { x, y, w, h };
}

function updateZoomLabel() {
  dom.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function updateStageViewport() {
  const width = state.image ? state.imageWidth : DEFAULT_STAGE_SIZE;
  const height = state.image ? state.imageHeight : DEFAULT_STAGE_SIZE;
  const zoomedWidth = Math.max(DEFAULT_STAGE_SIZE, Math.round(width * state.zoom));
  const zoomedHeight = Math.max(DEFAULT_STAGE_SIZE, Math.round(height * state.zoom));

  dom.stage.style.width = `${width}px`;
  dom.stage.style.height = `${height}px`;
  dom.stage.style.transform = `scale(${state.zoom})`;
  dom.stageViewport.style.width = `${zoomedWidth}px`;
  dom.stageViewport.style.height = `${zoomedHeight}px`;
  updateZoomLabel();
}

function setZoom(nextZoom, anchorEvent) {
  const clamped = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
  if (!Number.isFinite(clamped) || Math.abs(clamped - state.zoom) < 0.0001) return;

  let imageAnchor = null;
  if (anchorEvent && state.image) {
    imageAnchor = getStagePoint(anchorEvent);
  }

  state.zoom = clamped;
  updateStageViewport();

  if (!imageAnchor || !anchorEvent) return;

  const stageRect = dom.stage.getBoundingClientRect();
  const targetClientX = stageRect.left + imageAnchor.x * state.zoom;
  const targetClientY = stageRect.top + imageAnchor.y * state.zoom;
  dom.stageWrap.scrollLeft += targetClientX - anchorEvent.clientX;
  dom.stageWrap.scrollTop += targetClientY - anchorEvent.clientY;
}

function setExportStatus(message, isError = false) {
  dom.exportStatus.textContent = message;
  dom.exportStatus.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function isDesktopApp() {
  return Boolean(desktopBridge && desktopBridge.isDesktop);
}

function useCtrlForZoom() {
  return /^win/i.test(platform);
}

function isImageFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true;
  const name = String(file.name || '');
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function updateBlackGapInputState() {
  const barCount = Number(dom.blackBarCount.value);
  dom.blackGap.disabled = barCount <= 1;
}

function setMaskType(type, options = {}) {
  state.currentMaskType = type === 'black' ? 'black' : 'mosaic';

  const isMosaic = state.currentMaskType === 'mosaic';
  dom.tabMosaic.classList.toggle('active', isMosaic);
  dom.tabBlack.classList.toggle('active', !isMosaic);
  dom.tabMosaic.setAttribute('aria-selected', String(isMosaic));
  dom.tabBlack.setAttribute('aria-selected', String(!isMosaic));
  dom.panelMosaic.classList.toggle('hidden', !isMosaic);
  dom.panelBlack.classList.toggle('hidden', isMosaic);

  if (!options.fromSnapshot) {
    const active = findLayerById(state.activeLayerId);
    if (active) {
      if (active.type === 'mosaic' && isMosaic) {
        dom.mosaicSize.value = String(active.blockSize || 16);
        dom.mosaicSizeValue.textContent = dom.mosaicSize.value;
      }
      if (active.type === 'black' && !isMosaic) {
        dom.blackBarCount.value = String(clamp(active.barCount || 1, 1, 5));
        dom.blackGap.value = String(Math.max(0, active.barGap || 0));
      }
    }
  }

  updateBlackGapInputState();
}

function resetDragState() {
  dragState.mode = null;
  dragState.pointerId = null;
  dragState.layerId = null;
  dragState.startX = 0;
  dragState.startY = 0;
  dragState.initialFrame = null;
  dragState.draftRect = null;
  dragState.beforeGesture = null;
  dragState.rotateStartAngle = 0;
  dragState.initialLayerAngle = 0;
}

function resetEditor() {
  state.image = null;
  state.imageWidth = 0;
  state.imageHeight = 0;
  state.zoom = 1;
  state.layers = [];
  state.activeLayerId = null;
  state.past = [];
  state.future = [];
  state.idSeq = 1;

  dom.fileInput.value = '';
  dom.selectionBox.classList.add('hidden');
  dom.mosaicSize.value = '16';
  dom.mosaicSizeValue.textContent = '16';

  sourceCanvas.width = DEFAULT_STAGE_SIZE;
  sourceCanvas.height = DEFAULT_STAGE_SIZE;
  sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);

  dom.baseCanvas.width = DEFAULT_STAGE_SIZE;
  dom.baseCanvas.height = DEFAULT_STAGE_SIZE;
  baseCtx.clearRect(0, 0, dom.baseCanvas.width, dom.baseCanvas.height);

  updateStageViewport();
  dom.overlay.textContent = '';
  resetDragState();
  syncButtons();
}

function setImageFromFile(file) {
  if (!isImageFile(file)) {
    setExportStatus('画像ファイルを選択してください。', true);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.image = img;
      state.imageWidth = img.naturalWidth;
      state.imageHeight = img.naturalHeight;

      sourceCanvas.width = state.imageWidth;
      sourceCanvas.height = state.imageHeight;
      sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      sourceCtx.drawImage(img, 0, 0);

      dom.baseCanvas.width = state.imageWidth;
      dom.baseCanvas.height = state.imageHeight;
      baseCtx.clearRect(0, 0, dom.baseCanvas.width, dom.baseCanvas.height);
      baseCtx.drawImage(img, 0, 0);

      state.layers = [];
      state.activeLayerId = null;
      state.zoom = 1;
      state.past = [];
      state.future = [];
      state.idSeq = 1;

      updateStageViewport();
      resetDragState();
      renderAll();
      syncButtons();
      setExportStatus('画像を読み込みました。');
    };
    img.src = String(reader.result);
  };

  reader.readAsDataURL(file);
}

function buildMosaicCanvas(layer) {
  const srcW = Math.max(1, Math.round(layer.source.w));
  const srcH = Math.max(1, Math.round(layer.source.h));
  const blockSize = clamp(Math.round(layer.blockSize || 16), 1, 200);
  const miniW = Math.max(1, Math.ceil(srcW / blockSize));
  const miniH = Math.max(1, Math.ceil(srcH / blockSize));

  const mini = document.createElement('canvas');
  mini.width = miniW;
  mini.height = miniH;
  const miniCtx = mini.getContext('2d');
  miniCtx.drawImage(
    sourceCanvas,
    layer.source.x,
    layer.source.y,
    srcW,
    srcH,
    0,
    0,
    miniW,
    miniH,
  );

  const mosaic = document.createElement('canvas');
  mosaic.width = srcW;
  mosaic.height = srcH;
  const mosaicCtx = mosaic.getContext('2d');
  mosaicCtx.imageSmoothingEnabled = false;
  mosaicCtx.drawImage(mini, 0, 0, miniW, miniH, 0, 0, srcW, srcH);
  return mosaic;
}

function buildBlackMaskCanvas(layer) {
  const w = Math.max(1, Math.round(layer.frame.w));
  const h = Math.max(1, Math.round(layer.frame.h));
  const barCount = clamp(Math.round(layer.barCount || 1), 1, 5);
  const gap = Math.max(0, Math.round(layer.barGap || 0));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';

  if (barCount === 1) {
    ctx.fillRect(0, 0, w, h);
    return canvas;
  }

  const available = h - gap * (barCount - 1);
  const barHeight = Math.max(1, Math.floor(available / barCount));
  const totalHeight = barHeight * barCount + gap * (barCount - 1);
  let y = Math.max(0, Math.floor((h - totalHeight) / 2));

  for (let i = 0; i < barCount; i += 1) {
    if (y >= h) break;
    const drawH = Math.min(barHeight, h - y);
    if (drawH <= 0) break;
    ctx.fillRect(0, y, w, drawH);
    y += barHeight + gap;
  }

  return canvas;
}

function buildLayerCanvas(layer) {
  if (layer.type === 'black') {
    return buildBlackMaskCanvas(layer);
  }
  return buildMosaicCanvas(layer);
}

function findLayerById(id) {
  return state.layers.find((layer) => layer.id === id) || null;
}

function setActiveLayer(id) {
  state.activeLayerId = id;
  const layer = findLayerById(id);

  if (layer) {
    if (layer.type === 'mosaic') {
      dom.mosaicSize.value = String(layer.blockSize || 16);
      dom.mosaicSizeValue.textContent = dom.mosaicSize.value;
      setMaskType('mosaic');
    } else if (layer.type === 'black') {
      dom.blackBarCount.value = String(clamp(layer.barCount || 1, 1, 5));
      dom.blackGap.value = String(Math.max(0, layer.barGap || 0));
      setMaskType('black');
    }
  }

  updateBlackGapInputState();
  renderLayers();
}

function createLayerFromRect(rect) {
  const fitted = fitRectToImage(rect);
  if (state.currentMaskType === 'black') {
    return {
      id: state.idSeq++,
      type: 'black',
      source: null,
      frame: { ...fitted },
      blockSize: null,
      barCount: clamp(Number(dom.blackBarCount.value) || 1, 1, 5),
      barGap: Math.max(0, Number(dom.blackGap.value) || 0),
      angle: 0,
    };
  }

  return {
    id: state.idSeq++,
    type: 'mosaic',
    source: { ...fitted },
    frame: { ...fitted },
    blockSize: Number(dom.mosaicSize.value),
    barCount: null,
    barGap: null,
    angle: 0,
  };
}

function addLayerFromRect(rect) {
  if (rect.w < 5 || rect.h < 5) return;

  const before = snapshotState();
  const layer = createLayerFromRect(rect);
  state.layers.push(layer);
  state.activeLayerId = layer.id;

  commitHistory(before);
  renderAll();
}

function renderLayers() {
  dom.overlay.textContent = '';

  state.layers.forEach((layer) => {
    const layerEl = document.createElement('div');
    layerEl.className = `layer ${layer.type}`;
    if (layer.id === state.activeLayerId) {
      layerEl.classList.add('active');
    }

    layerEl.dataset.layerId = String(layer.id);
    layerEl.style.left = `${layer.frame.x}px`;
    layerEl.style.top = `${layer.frame.y}px`;
    layerEl.style.width = `${layer.frame.w}px`;
    layerEl.style.height = `${layer.frame.h}px`;
    layerEl.style.transform = `rotate(${layer.angle || 0}deg)`;

    const layerCanvas = document.createElement('canvas');
    layerCanvas.className = 'layer-canvas';
    const visualCanvas = buildLayerCanvas(layer);
    layerCanvas.width = visualCanvas.width;
    layerCanvas.height = visualCanvas.height;

    const layerCtx = layerCanvas.getContext('2d');
    layerCtx.imageSmoothingEnabled = false;
    layerCtx.drawImage(visualCanvas, 0, 0);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';

    layerEl.appendChild(layerCanvas);
    layerEl.appendChild(resizeHandle);

    if (layer.type === 'black') {
      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'rotate-handle';
      layerEl.appendChild(rotateHandle);
    }

    dom.overlay.appendChild(layerEl);
  });
}

function renderAll() {
  if (state.image) {
    baseCtx.clearRect(0, 0, dom.baseCanvas.width, dom.baseCanvas.height);
    baseCtx.drawImage(state.image, 0, 0);
  }
  renderLayers();
}

function beginSelection(event) {
  const point = getStagePoint(event);
  dragState.mode = 'select';
  dragState.pointerId = event.pointerId;
  dragState.startX = point.x;
  dragState.startY = point.y;
  dragState.draftRect = { x: point.x, y: point.y, w: 0, h: 0 };

  dom.selectionBox.classList.remove('hidden');
  dom.selectionBox.style.left = `${point.x}px`;
  dom.selectionBox.style.top = `${point.y}px`;
  dom.selectionBox.style.width = '0px';
  dom.selectionBox.style.height = '0px';
}

function beginLayerMove(event, layerId) {
  const layer = findLayerById(layerId);
  if (!layer) return;

  const point = getStagePoint(event);
  dragState.mode = 'move';
  dragState.pointerId = event.pointerId;
  dragState.layerId = layerId;
  dragState.startX = point.x;
  dragState.startY = point.y;
  dragState.initialFrame = { ...layer.frame };
  dragState.beforeGesture = snapshotState();
  setActiveLayer(layerId);
}

function beginLayerResize(event, layerId) {
  const layer = findLayerById(layerId);
  if (!layer) return;

  const point = getStagePoint(event);
  dragState.mode = 'resize';
  dragState.pointerId = event.pointerId;
  dragState.layerId = layerId;
  dragState.startX = point.x;
  dragState.startY = point.y;
  dragState.initialFrame = { ...layer.frame };
  dragState.beforeGesture = snapshotState();
  setActiveLayer(layerId);
}

function beginLayerRotate(event, layerId) {
  const layer = findLayerById(layerId);
  if (!layer) return;

  const point = getStagePoint(event);
  const cx = layer.frame.x + layer.frame.w / 2;
  const cy = layer.frame.y + layer.frame.h / 2;

  dragState.mode = 'rotate';
  dragState.pointerId = event.pointerId;
  dragState.layerId = layerId;
  dragState.beforeGesture = snapshotState();
  dragState.rotateStartAngle = Math.atan2(point.y - cy, point.x - cx);
  dragState.initialLayerAngle = layer.angle || 0;
  setActiveLayer(layerId);
}

function updateSelection(event) {
  const point = getStagePoint(event);
  dragState.draftRect = normalizeRect(dragState.startX, dragState.startY, point.x, point.y);
  dom.selectionBox.style.left = `${dragState.draftRect.x}px`;
  dom.selectionBox.style.top = `${dragState.draftRect.y}px`;
  dom.selectionBox.style.width = `${dragState.draftRect.w}px`;
  dom.selectionBox.style.height = `${dragState.draftRect.h}px`;
}

function updateLayerMove(event) {
  const layer = findLayerById(dragState.layerId);
  if (!layer) return;

  const point = getStagePoint(event);
  const dx = point.x - dragState.startX;
  const dy = point.y - dragState.startY;

  layer.frame.x = clamp(dragState.initialFrame.x + dx, 0, state.imageWidth - layer.frame.w);
  layer.frame.y = clamp(dragState.initialFrame.y + dy, 0, state.imageHeight - layer.frame.h);
  renderLayers();
}

function updateLayerResize(event) {
  const layer = findLayerById(dragState.layerId);
  if (!layer) return;

  const point = getStagePoint(event);
  const dx = point.x - dragState.startX;
  const dy = point.y - dragState.startY;
  const minSize = 8;

  layer.frame.w = clamp(dragState.initialFrame.w + dx, minSize, state.imageWidth - layer.frame.x);
  layer.frame.h = clamp(dragState.initialFrame.h + dy, minSize, state.imageHeight - layer.frame.y);
  renderLayers();
}

function updateLayerRotate(event) {
  const layer = findLayerById(dragState.layerId);
  if (!layer) return;

  const point = getStagePoint(event);
  const cx = layer.frame.x + layer.frame.w / 2;
  const cy = layer.frame.y + layer.frame.h / 2;
  const currentAngle = Math.atan2(point.y - cy, point.x - cx);
  const delta = ((currentAngle - dragState.rotateStartAngle) * 180) / Math.PI;

  layer.angle = normalizeAngle(dragState.initialLayerAngle + delta);
  renderLayers();
}

function endSelection() {
  dom.selectionBox.classList.add('hidden');
  if (dragState.draftRect) {
    addLayerFromRect(dragState.draftRect);
  }
  dragState.draftRect = null;
  resetDragState();
}

function endLayerGesture() {
  commitHistory(dragState.beforeGesture);
  resetDragState();
}

function clearAllMasks() {
  if (!state.layers.length) return;
  const before = snapshotState();
  state.layers = [];
  state.activeLayerId = null;
  commitHistory(before);
  renderLayers();
  setExportStatus('全マスクを削除しました。');
}

function sanitizeBaseName(name) {
  const trimmed = name.trim();
  const replaced = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[.\s]+$/g, '');
  return replaced || 'masking-output';
}

function drawLayerOnContext(ctx, layer) {
  const visual = buildLayerCanvas(layer);
  const angle = layer.angle || 0;
  const cx = layer.frame.x + layer.frame.w / 2;
  const cy = layer.frame.y + layer.frame.h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(toRadians(angle));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    visual,
    0,
    0,
    visual.width,
    visual.height,
    -layer.frame.w / 2,
    -layer.frame.h / 2,
    layer.frame.w,
    layer.frame.h,
  );
  ctx.restore();
}

function createCompositeCanvas() {
  const out = document.createElement('canvas');
  out.width = state.imageWidth;
  out.height = state.imageHeight;
  const outCtx = out.getContext('2d');

  outCtx.drawImage(state.image, 0, 0);
  state.layers.forEach((layer) => {
    drawLayerOnContext(outCtx, layer);
  });

  return out;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG変換に失敗しました。'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

async function ensureDirectoryPermission(handle) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

async function chooseDirectory() {
  if (isDesktopApp()) {
    try {
      const result = await desktopBridge.pickSaveDirectory();
      if (!result || !result.ok) return false;
      state.directoryPath = result.directoryPath;
      state.directoryName = result.folderName || '';
      state.directoryHandle = null;
      dom.folderNameInput.value = state.directoryName || '未選択';
      setExportStatus(`保存フォルダ: ${state.directoryName}`);
      return true;
    } catch (err) {
      setExportStatus('フォルダの選択に失敗しました。', true);
      return false;
    }
  }

  if (!window.showDirectoryPicker) {
    setExportStatus('このブラウザはフォルダ指定保存に未対応です。Chrome系をご利用ください。', true);
    return false;
  }

  try {
    const handle = await window.showDirectoryPicker();
    state.directoryHandle = handle;
    state.directoryPath = null;
    dom.folderNameInput.value = handle.name;
    state.directoryName = handle.name;
    setExportStatus(`保存フォルダ: ${handle.name}`);
    return true;
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      setExportStatus('フォルダの選択に失敗しました。', true);
    }
    return false;
  }
}

async function getUniqueFileName(directoryHandle, baseName) {
  let counter = 0;
  while (counter < 10000) {
    const suffix = counter === 0 ? '' : `-${String(counter).padStart(2, '0')}`;
    const candidate = `${baseName}${suffix}.png`;
    try {
      await directoryHandle.getFileHandle(candidate, { create: false });
      counter += 1;
    } catch (err) {
      if (err && err.name === 'NotFoundError') {
        return candidate;
      }
      throw err;
    }
  }
  return `${baseName}-${Date.now()}.png`;
}

async function exportAsPng() {
  if (!state.image) return;

  if (isDesktopApp()) {
    if (!state.directoryPath) {
      const selected = await chooseDirectory();
      if (!selected) return;
    }
  } else if (!state.directoryHandle) {
    const selected = await chooseDirectory();
    if (!selected) return;
  }

  try {
    dom.exportBtn.disabled = true;
    setExportStatus('PNGを書き出し中...');

    const out = createCompositeCanvas();
    const blob = await canvasToBlob(out);
    const baseName = sanitizeBaseName(dom.fileNameInput.value);

    if (isDesktopApp()) {
      const arrayBuffer = await blob.arrayBuffer();
      const result = await desktopBridge.savePngFile({
        directoryPath: state.directoryPath,
        baseName,
        bytes: new Uint8Array(arrayBuffer),
      });
      if (!result || !result.ok) {
        throw new Error(result && result.error ? result.error : 'PNG出力に失敗しました。');
      }
      state.directoryName = result.folderName || state.directoryName || '';
      dom.folderNameInput.value = state.directoryName || '未選択';
      setExportStatus(`保存完了: ${result.folderName}/${result.fileName}`);
      return;
    }

    if (!(await ensureDirectoryPermission(state.directoryHandle))) {
      setExportStatus('フォルダへの書き込み権限がありません。', true);
      return;
    }

    const uniqueName = await getUniqueFileName(state.directoryHandle, baseName);
    const fileHandle = await state.directoryHandle.getFileHandle(uniqueName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    setExportStatus(`保存完了: ${state.directoryHandle.name}/${uniqueName}`);
  } catch (err) {
    console.error(err);
    setExportStatus(err && err.message ? err.message : 'PNG出力に失敗しました。', true);
  } finally {
    syncButtons();
  }
}

function onMosaicSliderInput() {
  dom.mosaicSizeValue.textContent = dom.mosaicSize.value;
  const active = findLayerById(state.activeLayerId);
  if (!active || active.type !== 'mosaic') return;

  if (!dragState.sliderBeforeGesture) {
    dragState.sliderBeforeGesture = snapshotState();
  }
  active.blockSize = Number(dom.mosaicSize.value);
  renderLayers();
}

function onMosaicSliderCommit() {
  if (!dragState.sliderBeforeGesture) return;
  commitHistory(dragState.sliderBeforeGesture);
  dragState.sliderBeforeGesture = null;
}

function onBlackControlsInput() {
  const barCount = clamp(Number(dom.blackBarCount.value) || 1, 1, 5);
  const barGap = Math.max(0, Number(dom.blackGap.value) || 0);

  dom.blackBarCount.value = String(barCount);
  dom.blackGap.value = String(barGap);
  updateBlackGapInputState();

  state.blackDefaults.barCount = barCount;
  state.blackDefaults.barGap = barGap;

  const active = findLayerById(state.activeLayerId);
  if (!active || active.type !== 'black') return;

  if (!dragState.blackBeforeGesture) {
    dragState.blackBeforeGesture = snapshotState();
  }

  active.barCount = barCount;
  active.barGap = barGap;
  renderLayers();
}

function onBlackControlsCommit() {
  if (!dragState.blackBeforeGesture) return;
  commitHistory(dragState.blackBeforeGesture);
  dragState.blackBeforeGesture = null;
}

function detectInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
  } catch (_err) {
    // Ignore storage errors and fallback.
  }

  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  dom.themeToggleBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch (_err) {
    // Ignore storage errors.
  }
}

function installCollapsibleSections() {
  const sections = document.querySelectorAll('[data-collapsible]');
  sections.forEach((section, index) => {
    const body = section.querySelector('.section-body');
    const button = section.querySelector('.collapse-btn');
    if (!body || !button) return;

    if (!body.id) {
      body.id = `sectionBody${index + 1}`;
    }
    button.setAttribute('aria-controls', body.id);
    button.setAttribute('aria-expanded', 'true');
    button.textContent = '▾';

    button.addEventListener('click', () => {
      const collapsed = section.classList.toggle('collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.textContent = collapsed ? '▸' : '▾';
    });
  });
}

function installGlobalEvents() {
  dom.fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) setImageFromFile(file);
    event.target.value = '';
  });

  dom.undoBtn.addEventListener('click', undo);
  dom.redoBtn.addEventListener('click', redo);
  dom.clearMasksBtn.addEventListener('click', clearAllMasks);
  dom.resetBtn.addEventListener('click', () => {
    if (!state.image) return;
    resetEditor();
    setExportStatus('編集内容をリセットしました。');
  });

  dom.exportBtn.addEventListener('click', exportAsPng);
  dom.selectFolderBtn.addEventListener('click', chooseDirectory);
  dom.themeToggleBtn.addEventListener('click', toggleTheme);

  dom.tabMosaic.addEventListener('click', () => setMaskType('mosaic'));
  dom.tabBlack.addEventListener('click', () => setMaskType('black'));

  dom.fileNameInput.addEventListener('blur', () => {
    dom.fileNameInput.value = sanitizeBaseName(dom.fileNameInput.value);
  });

  dom.mosaicSize.addEventListener('pointerdown', () => {
    const active = findLayerById(state.activeLayerId);
    dragState.sliderBeforeGesture = active && active.type === 'mosaic' ? snapshotState() : null;
  });
  dom.mosaicSize.addEventListener('input', onMosaicSliderInput);
  dom.mosaicSize.addEventListener('change', onMosaicSliderCommit);

  dom.blackBarCount.addEventListener('pointerdown', () => {
    const active = findLayerById(state.activeLayerId);
    dragState.blackBeforeGesture = active && active.type === 'black' ? snapshotState() : null;
  });
  dom.blackGap.addEventListener('pointerdown', () => {
    const active = findLayerById(state.activeLayerId);
    dragState.blackBeforeGesture = active && active.type === 'black' ? snapshotState() : null;
  });
  dom.blackBarCount.addEventListener('input', onBlackControlsInput);
  dom.blackGap.addEventListener('input', onBlackControlsInput);
  dom.blackBarCount.addEventListener('change', onBlackControlsCommit);
  dom.blackGap.addEventListener('change', onBlackControlsCommit);

  dom.stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !state.image) return;

    const rotateHandle = event.target.closest('.rotate-handle');
    const resizeHandle = event.target.closest('.resize-handle');
    const layerEl = event.target.closest('.layer');

    if (rotateHandle && layerEl) {
      beginLayerRotate(event, Number(layerEl.dataset.layerId));
      return;
    }

    if (resizeHandle && layerEl) {
      beginLayerResize(event, Number(layerEl.dataset.layerId));
      return;
    }

    if (layerEl) {
      beginLayerMove(event, Number(layerEl.dataset.layerId));
      return;
    }

    beginSelection(event);
  });

  window.addEventListener('pointermove', (event) => {
    if (!dragState.mode || event.pointerId !== dragState.pointerId) return;

    if (dragState.mode === 'select') {
      updateSelection(event);
      return;
    }
    if (dragState.mode === 'move') {
      updateLayerMove(event);
      return;
    }
    if (dragState.mode === 'resize') {
      updateLayerResize(event);
      return;
    }
    if (dragState.mode === 'rotate') {
      updateLayerRotate(event);
    }
  });

  window.addEventListener('pointerup', (event) => {
    if (!dragState.mode || event.pointerId !== dragState.pointerId) return;

    if (dragState.mode === 'select') {
      endSelection();
      return;
    }

    if (dragState.mode === 'move' || dragState.mode === 'resize' || dragState.mode === 'rotate') {
      endLayerGesture();
    }
  });

  window.addEventListener('pointercancel', (event) => {
    if (!dragState.mode || event.pointerId !== dragState.pointerId) return;

    if (dragState.mode === 'select') {
      dom.selectionBox.classList.add('hidden');
    }
    resetDragState();
  });

  document.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  document.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) setImageFromFile(file);
  });

  document.addEventListener('keydown', (event) => {
    const cmdOrCtrl = event.metaKey || event.ctrlKey;
    if (!cmdOrCtrl) return;

    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redo();
    }
  });

  dom.stageWrap.addEventListener(
    'wheel',
    (event) => {
      if (!state.image) return;
      const zoomModifierPressed = useCtrlForZoom() ? event.ctrlKey : event.metaKey;
      if (!zoomModifierPressed) return;
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.0015);
      setZoom(state.zoom * zoomFactor, event);
    },
    { passive: false },
  );
}

function bootstrap() {
  try {
    applyTheme(detectInitialTheme());
    resetEditor();
    setMaskType('mosaic');
    updateBlackGapInputState();
    installCollapsibleSections();
    installGlobalEvents();
    const runtimeLabel = isDesktopApp() ? 'デスクトップモード' : 'Webモード';
    setExportStatus(`${runtimeLabel}: 保存先フォルダを選択してPNG出力できます。`);
  } catch (err) {
    console.error('Bootstrap failed:', err);
    if (dom.exportStatus) {
      setExportStatus('初期化に失敗しました。コンソールログを確認してください。', true);
    }
  }
}

bootstrap();
