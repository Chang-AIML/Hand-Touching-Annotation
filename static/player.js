/* ================================================================
   HICE Annotation Tool — player.js
   ================================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────────
const state = {
  videos: [],            // [{id, frame_count, selected_count, annotated}]
  currentVideo: null,    // video id string
  frames: [],            // sorted list of filenames
  frameIndex: 0,         // current frame index (0-based)
  playing: false,
  fps: 30,
  fpsSlow: 5,
  annotation: null,      // {video_id, selected_frames: [], history: []}
  cache: new Map(),      // filename -> HTMLImageElement (loaded)
  rafId: null,
  lastFrameTime: 0,
};

// ── DOM refs ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const videoList       = $('video-list');
const progressSummary = $('progress-summary');
const searchInput     = $('search-input');
const welcome         = $('welcome');
const playerContainer = $('player-container');
const videoTitle      = $('video-title');
const fpsSlider       = $('fps-slider');
const fpsValue        = $('fps-value');
const fpsSlowSlider   = $('fps-slow-slider');
const fpsSlowValue    = $('fps-slow-value');
const frameCanvas     = $('frame-canvas');
const ctx             = frameCanvas.getContext('2d');
const pausedOverlay   = $('paused-overlay');
const progressCanvas  = $('progress-canvas');
const pctx            = progressCanvas.getContext('2d');
const progressTooltip = $('progress-tooltip');
const frameCounter    = $('frame-counter');
const frameFilename   = $('frame-filename');
const btnPlayPause    = $('btn-play-pause');
const btnAnnotate     = $('btn-annotate');
const btnUndo         = $('btn-undo');
const btnDone         = $('btn-done');
const btnSkip         = $('btn-skip');
const btnReview       = $('btn-review');
const diffBtns        = document.querySelectorAll('.diff-btn');
const annList         = $('ann-list');
const annCount        = $('ann-count');

// ── Helpers ───────────────────────────────────────────────────────
function frameUrl(videoId, filename) {
  return `/frames/${videoId}/${filename}`;
}

function loadImage(videoId, filename) {
  const key = filename;
  if (state.cache.has(key)) return state.cache.get(key);
  const img = new Image();
  img.src = frameUrl(videoId, filename);
  state.cache.set(key, img);
  return img;
}

function prefetch(videoId, around, radius = 40) {
  const start = Math.max(0, around - 10);
  const end   = Math.min(state.frames.length - 1, around + radius);
  for (let i = start; i <= end; i++) {
    loadImage(videoId, state.frames[i]);
  }
}

function clearCache() {
  state.cache.clear();
}

// ── Render current frame ──────────────────────────────────────────
function renderFrame() {
  if (!state.frames.length) return;
  const filename = state.frames[state.frameIndex];
  const img = loadImage(state.currentVideo, filename);

  const draw = () => {
    const wrapper = frameCanvas.parentElement;
    const ww = wrapper.clientWidth  || 640;
    const wh = wrapper.clientHeight || 480;
    const iw = img.naturalWidth  || 640;
    const ih = img.naturalHeight || 480;
    const scale = Math.min(ww / iw, wh / ih);
    frameCanvas.width  = Math.round(iw * scale);
    frameCanvas.height = Math.round(ih * scale);
    ctx.drawImage(img, 0, 0, frameCanvas.width, frameCanvas.height);
    drawProgressBar();
  };

  if (img.complete && img.naturalWidth) {
    draw();
  } else {
    img.onload = draw;
  }

  frameCounter.textContent = `Frame ${state.frameIndex + 1} / ${state.frames.length}`;
  frameFilename.textContent = filename;
  highlightCurrentInAnnList();

  // Flash red border when playback hits a labeled frame
  const frameName = filename.replace('.jpg', '');
  const isLabeled = state.annotation?.selected_frames.includes(frameName);
  if (isLabeled && state._lastFlashed !== frameName) {
    state._lastFlashed = frameName;
    const wrapper = frameCanvas.parentElement;
    wrapper.classList.remove('flash-labeled');
    // Force reflow so animation restarts
    void wrapper.offsetWidth;
    wrapper.classList.add('flash-labeled');
    wrapper.addEventListener('animationend', () => wrapper.classList.remove('flash-labeled'), { once: true });
  }
  if (!isLabeled) state._lastFlashed = null;
}

// ── Progress bar ──────────────────────────────────────────────────
function drawProgressBar() {
  const w = progressCanvas.offsetWidth || progressCanvas.parentElement.offsetWidth;
  const h = 36;
  progressCanvas.width  = w;
  progressCanvas.height = h;

  const n = state.frames.length;
  if (!n) return;

  // Track background
  pctx.fillStyle = '#2d3748';
  roundRect(pctx, 0, 14, w, 10, 5);
  pctx.fill();

  // Labeled frame markers — diamond shape + glow
  const selected = state.annotation?.selected_frames || [];
  selected.forEach(fname => {
    const idx = state.frames.indexOf(fname + '.jpg');
    if (idx === -1) return;
    const x = Math.round((idx / Math.max(n - 1, 1)) * w);

    // Glow
    pctx.save();
    pctx.shadowColor = '#facc15';
    pctx.shadowBlur = 8;
    pctx.fillStyle = '#facc15';
    // Diamond: center at (x, 10), half-width 6, half-height 10
    pctx.beginPath();
    pctx.moveTo(x, 1);        // top
    pctx.lineTo(x + 6, 10);   // right
    pctx.lineTo(x, 32);       // bottom
    pctx.lineTo(x - 6, 10);   // left
    pctx.closePath();
    pctx.fill();
    pctx.restore();
  });

  // Playhead
  const px = Math.round((state.frameIndex / Math.max(n - 1, 1)) * w);
  pctx.fillStyle = '#e94560';
  roundRect(pctx, px - 3, 8, 6, 22, 3);
  pctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Progress bar hover tooltip ─────────────────────────────────────
progressCanvas.addEventListener('mousemove', e => {
  if (scrubbing) return;
  if (!state.frames.length) return;

  const rect = progressCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const n = state.frames.length;
  const selected = state.annotation?.selected_frames || [];

  // Check proximity to any labeled marker
  let hit = null;
  for (const fname of selected) {
    const idx = state.frames.indexOf(fname + '.jpg');
    if (idx === -1) continue;
    const x = Math.round((idx / Math.max(n - 1, 1)) * progressCanvas.offsetWidth);
    if (Math.abs(mx - x) <= 8) { hit = fname; break; }
  }

  if (hit) {
    progressTooltip.textContent = `Labeled: ${hit}`;
    progressTooltip.style.left = `${e.clientX - rect.left}px`;
    progressTooltip.style.opacity = '1';
  } else {
    // Show current position frame
    const idx = Math.round((mx / progressCanvas.offsetWidth) * (n - 1));
    const clamped = Math.max(0, Math.min(n - 1, idx));
    progressTooltip.textContent = state.frames[clamped]?.replace('.jpg', '') ?? '';
    progressTooltip.style.left = `${mx}px`;
    progressTooltip.style.opacity = '1';
  }
});

progressCanvas.addEventListener('mouseleave', () => {
  progressTooltip.style.opacity = '0';
});

// ── Playback loop ─────────────────────────────────────────────────
const SLOWDOWN_RADIUS = 5;   // frames either side of a label

function nearLabeledFrame() {
  if (!state.annotation?.selected_frames.length) return false;
  return state.annotation.selected_frames.some(fname => {
    const idx = state.frames.indexOf(fname + '.jpg');
    return idx !== -1 && Math.abs(idx - state.frameIndex) <= SLOWDOWN_RADIUS;
  });
}

function playLoop(ts) {
  if (!state.playing) return;
  const effectiveFps = nearLabeledFrame() ? state.fpsSlow : state.fps;
  const interval = 1000 / effectiveFps;
  if (ts - state.lastFrameTime >= interval) {
    state.lastFrameTime = ts;
    if (state.frameIndex < state.frames.length - 1) {
      state.frameIndex++;
    } else {
      state.frameIndex = 0;
    }
    renderFrame();
    prefetch(state.currentVideo, state.frameIndex);
  }
  state.rafId = requestAnimationFrame(playLoop);
}

function play() {
  if (state.playing) return;
  state.playing = true;
  btnPlayPause.textContent = '⏸ Pause';
  pausedOverlay.className = 'overlay-hidden';
  state.lastFrameTime = performance.now();
  state.rafId = requestAnimationFrame(playLoop);
}

function pause() {
  if (!state.playing) return;
  state.playing = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  btnPlayPause.textContent = '▶ Play';
  pausedOverlay.className = 'overlay-visible';
}

function togglePlay() {
  state.playing ? pause() : play();
}

// ── Step frames ───────────────────────────────────────────────────
function stepFrame(delta) {
  const n = state.frames.length;
  if (!n) return;
  pause();
  state.frameIndex = Math.max(0, Math.min(n - 1, state.frameIndex + delta));
  renderFrame();
  prefetch(state.currentVideo, state.frameIndex);
}

// ── Annotation actions ────────────────────────────────────────────
async function annotateCurrentFrame() {
  if (!state.annotation || !state.frames.length) return;
  const filename = state.frames[state.frameIndex];
  const frameName = filename.replace('.jpg', '');

  if (state.annotation.selected_frames.includes(frameName)) return;

  state.annotation.selected_frames.push(frameName);
  state.annotation.history.push({
    action: 'select',
    frame: frameName,
    timestamp: new Date().toISOString(),
  });

  await saveAnnotation();
  renderAnnList();
  drawProgressBar();
  btnUndo.disabled = false;

  frameCanvas.parentElement.classList.add('flash-annotate');
  setTimeout(() => frameCanvas.parentElement.classList.remove('flash-annotate'), 400);
}

async function undoLast() {
  if (!state.annotation || !state.annotation.selected_frames.length) return;
  const removed = state.annotation.selected_frames.pop();
  state.annotation.history.push({
    action: 'undo',
    removed_frame: removed,
    timestamp: new Date().toISOString(),
  });

  await saveAnnotation();
  renderAnnList();
  drawProgressBar();
  btnUndo.disabled = state.annotation.selected_frames.length === 0;
}

async function removeClosestFrame() {
  if (!state.annotation || !state.annotation.selected_frames.length) return;

  // Map each labeled frame to its sequence index
  const candidates = state.annotation.selected_frames.map(fname => ({
    fname,
    idx: state.frames.indexOf(fname + '.jpg'),
  })).filter(c => c.idx !== -1);

  if (!candidates.length) return;

  // Find minimum distance
  const minDist = Math.min(...candidates.map(c => Math.abs(c.idx - state.frameIndex)));

  // Check for tie: more than one frame at the same minimum distance
  const closest = candidates.filter(c => Math.abs(c.idx - state.frameIndex) === minDist);
  if (closest.length > 1) return; // equidistant — do nothing

  await removeFrame(closest[0].fname);
}

async function removeFrame(frameName) {
  if (!state.annotation) return;
  const idx = state.annotation.selected_frames.indexOf(frameName);
  if (idx === -1) return;
  state.annotation.selected_frames.splice(idx, 1);
  state.annotation.history.push({
    action: 'undo',
    removed_frame: frameName,
    timestamp: new Date().toISOString(),
  });
  await saveAnnotation();
  renderAnnList();
  drawProgressBar();
  btnUndo.disabled = state.annotation.selected_frames.length === 0;
}

// ── Render annotation list ────────────────────────────────────────
function renderAnnList() {
  if (!state.annotation) { annList.innerHTML = ''; return; }
  // Sort by frame index (chronological order)
  const frames = [...state.annotation.selected_frames].sort((a, b) => {
    return state.frames.indexOf(a + '.jpg') - state.frames.indexOf(b + '.jpg');
  });
  annCount.textContent = `${frames.length} frame${frames.length !== 1 ? 's' : ''}`;
  annList.innerHTML = '';
  frames.forEach(fname => {
    const li = document.createElement('li');
    li.className = 'ann-item';
    li.dataset.frame = fname;

    const span = document.createElement('span');
    span.textContent = fname + '.jpg';

    const rm = document.createElement('button');
    rm.className = 'ann-remove';
    rm.textContent = '✕';
    rm.title = 'Remove this frame';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      removeFrame(fname);
    });

    li.appendChild(span);
    li.appendChild(rm);
    li.addEventListener('click', () => jumpToFrame(fname));
    annList.appendChild(li);
  });
  highlightCurrentInAnnList();
}

function highlightCurrentInAnnList() {
  if (!state.frames.length) return;
  const current = state.frames[state.frameIndex]?.replace('.jpg', '');
  annList.querySelectorAll('.ann-item').forEach(li => {
    li.classList.toggle('current', li.dataset.frame === current);
  });
}

function jumpToFrame(frameName) {
  const idx = state.frames.indexOf(frameName + '.jpg');
  if (idx === -1) return;
  pause();
  state.frameIndex = idx;
  renderFrame();
}

// ── API calls ─────────────────────────────────────────────────────
async function saveAnnotation() {
  const res = await fetch(`/api/annotation/${state.currentVideo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.annotation),
  });
  if (!res.ok) console.error('Save failed', res.status);

  // Update badge in sidebar
  const item = videoList.querySelector(`.video-item[data-id="${state.currentVideo}"]`);
  if (item) {
    const count = state.annotation.selected_frames.length;
    let badge = item.querySelector('.video-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'video-badge';
        item.appendChild(badge);
      }
      badge.textContent = count;
      item.classList.add('annotated');
    } else {
      badge?.remove();
      item.classList.remove('annotated');
    }
  }
  // Keep state.videos in sync so refreshProgressSummary() has accurate data
  const vidIdx = state.videos.findIndex(v => v.id === state.currentVideo);
  if (vidIdx !== -1) {
    const count = state.annotation.selected_frames.length;
    state.videos[vidIdx].selected_count = count;
    state.videos[vidIdx].annotated = count > 0;
    state.videos[vidIdx].status = state.annotation.status || null;
  }

  updateDoneState();
  refreshProgressSummary();
}

// ── Done / Skip / Review + Difficulty ────────────────────────────
function updateDoneState() {
  if (!state.annotation) return;
  const status = state.annotation.status || null;
  const diff   = state.annotation.difficulty || null;

  // Status buttons — mutually exclusive, toggle off on re-click
  btnDone.textContent   = status === 'done'   ? '★ Unmark Done' : '★ Mark Done';
  btnSkip.textContent   = status === 'skip'   ? '⊘ Unskip'     : '⊘ Skip';
  btnReview.textContent = status === 'review' ? '👁 Unreview'   : '👁 Review';
  btnDone.classList.toggle('is-done',   status === 'done');
  btnSkip.classList.toggle('is-active', status === 'skip');
  btnReview.classList.toggle('is-active', status === 'review');

  // Difficulty buttons
  diffBtns.forEach(btn => btn.classList.toggle('selected', btn.dataset.diff === diff));

  // Sidebar item
  const item = videoList.querySelector(`.video-item[data-id="${state.currentVideo}"]`);
  if (item) {
    item.classList.toggle('done',   status === 'done');
    item.classList.toggle('skip',   status === 'skip');
    item.classList.toggle('review', status === 'review');
    // Update or remove difficulty tag
    let tag = item.querySelector('.diff-tag');
    if (diff) {
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'diff-tag';
        item.appendChild(tag);
      }
      tag.className = `diff-tag ${diff}`;
      tag.textContent = diff;
    } else {
      tag?.remove();
    }
  }
}

async function setStatus(newStatus) {
  if (!state.annotation) return;
  // Toggle off if same button clicked again
  const current = state.annotation.status || null;
  state.annotation.status = (current === newStatus) ? null : newStatus;
  // Keep backward-compat 'completed' field in sync
  state.annotation.completed = (state.annotation.status === 'done');
  state.annotation.history.push({
    action: 'set_status',
    status: state.annotation.status,
    timestamp: new Date().toISOString(),
  });
  await saveAnnotation();
}

async function setDifficulty(diff) {
  if (!state.annotation) return;
  // Toggle off if same value clicked again
  state.annotation.difficulty = state.annotation.difficulty === diff ? null : diff;
  state.annotation.history.push({
    action: 'set_difficulty',
    difficulty: state.annotation.difficulty,
    timestamp: new Date().toISOString(),
  });
  await saveAnnotation();
}

// ── Load video ────────────────────────────────────────────────────
// opts: { startPaused: bool, jumpToLastLabel: bool }
async function loadVideo(videoId, opts = {}) {
  pause();
  clearCache();
  state.currentVideo = videoId;
  state.frameIndex = 0;
  state.frames = [];
  state.annotation = null;
  annList.innerHTML = '';
  annCount.textContent = '0 frames';
  btnUndo.disabled = true;

  videoList.querySelectorAll('.video-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === videoId);
  });

  videoTitle.textContent = videoId;
  welcome.style.display = 'none';
  playerContainer.style.display = 'flex';

  const [framesRes, annRes] = await Promise.all([
    fetch(`/api/video/${videoId}/frames`),
    fetch(`/api/annotation/${videoId}`),
  ]);

  state.frames = await framesRes.json();
  state.annotation = await annRes.json();

  // Backward compat: if status field missing but completed=true, treat as 'done'
  if (!state.annotation.status && state.annotation.completed) {
    state.annotation.status = 'done';
  }

  btnUndo.disabled = state.annotation.selected_frames.length === 0;
  renderAnnList();
  updateDoneState();

  // Jump to last labeled frame if requested
  if (opts.jumpToLastLabel && state.annotation.selected_frames.length > 0) {
    // Find the frame with the highest sequence index
    const lastFrame = [...state.annotation.selected_frames].sort((a, b) => {
      return state.frames.indexOf(b + '.jpg') - state.frames.indexOf(a + '.jpg');
    })[0];
    const idx = state.frames.indexOf(lastFrame + '.jpg');
    if (idx !== -1) state.frameIndex = idx;
  }

  prefetch(videoId, state.frameIndex, 60);
  renderFrame();

  if (!opts.startPaused) {
    play();
  } else {
    // Show paused state explicitly
    btnPlayPause.textContent = '▶ Play';
    pausedOverlay.className = 'overlay-visible';
  }
}

// ── Progress bar scrub ────────────────────────────────────────────
let scrubbing = false;
let wasPlaying = false;

function scrubTo(clientX) {
  if (!state.frames.length) return;
  const rect = progressCanvas.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const idx = Math.round(ratio * (state.frames.length - 1));
  state.frameIndex = idx;
  renderFrame();
}

progressCanvas.addEventListener('mousedown', e => {
  if (!state.frames.length) return;
  scrubbing = true;
  wasPlaying = state.playing;
  pause();
  scrubTo(e.clientX);
  progressCanvas.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', e => {
  if (!scrubbing) return;
  scrubTo(e.clientX);
});

document.addEventListener('mouseup', e => {
  if (!scrubbing) return;
  scrubbing = false;
  progressCanvas.style.cursor = 'pointer';
  scrubTo(e.clientX);
  if (wasPlaying) play();
});

// ── Keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!state.currentVideo) return;
  if (document.activeElement === searchInput) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      stepFrame(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      stepFrame(1);
      break;
    case 'Enter':
      e.preventDefault();
      annotateCurrentFrame();
      break;
    case 'z':
    case 'Z':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        undoLast();
      }
      break;
    case 'Backspace':
      e.preventDefault();
      removeClosestFrame();
      break;
  }
});

// ── Buttons ───────────────────────────────────────────────────────
btnPlayPause.addEventListener('click', togglePlay);
btnAnnotate.addEventListener('click', annotateCurrentFrame);
btnUndo.addEventListener('click', undoLast);
btnDone.addEventListener('click',   () => setStatus('done'));
btnSkip.addEventListener('click',   () => setStatus('skip'));
btnReview.addEventListener('click', () => setStatus('review'));
diffBtns.forEach(btn => btn.addEventListener('click', () => setDifficulty(btn.dataset.diff)));

fpsSlider.addEventListener('input', () => {
  state.fps = parseInt(fpsSlider.value, 10);
  fpsValue.textContent = state.fps;
});

fpsSlowSlider.addEventListener('input', () => {
  state.fpsSlow = parseInt(fpsSlowSlider.value, 10);
  fpsSlowValue.textContent = state.fpsSlow;
});

// ── Sidebar: video list ───────────────────────────────────────────
function renderVideoList(videos) {
  videoList.innerHTML = '';
  videos.forEach(v => {
    const status = v.status || null;
    const li = document.createElement('li');
    li.className = 'video-item' +
      (v.annotated          ? ' annotated' : '') +
      (status === 'done'    ? ' done'      : '') +
      (status === 'skip'    ? ' skip'      : '') +
      (status === 'review'  ? ' review'    : '');
    li.dataset.id = v.id;

    const name = document.createElement('span');
    name.className = 'video-name';
    name.textContent = v.id;
    name.title = v.id;
    li.appendChild(name);

    if (v.selected_count > 0) {
      const badge = document.createElement('span');
      badge.className = 'video-badge';
      badge.textContent = v.selected_count;
      li.appendChild(badge);
    }

    if (v.difficulty) {
      const tag = document.createElement('span');
      tag.className = `diff-tag ${v.difficulty}`;
      tag.textContent = v.difficulty;
      li.appendChild(tag);
    }

    li.addEventListener('click', () => loadVideo(v.id));
    videoList.appendChild(li);
  });
}

function refreshProgressSummary() {
  const total     = state.videos.length;
  const annotated = state.videos.filter(v =>
    v.annotated || v.status === 'done' || v.status === 'review'
  ).length;
  const skipped   = state.videos.filter(v => v.status === 'skip').length;
  const remaining = state.videos.filter(v => !v.annotated && !v.status).length;
  progressSummary.innerHTML =
    `Annotated: ${annotated} / ${total}<br>` +
    `Skipped: ${skipped} / ${total}<br>` +
    `Remaining: ${remaining} / ${total}`;
}

// ── Search ────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase();
  videoList.querySelectorAll('.video-item').forEach(el => {
    el.style.display = el.dataset.id.includes(q) ? '' : 'none';
  });
});

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/videos');
  state.videos = await res.json();

  renderVideoList(state.videos);
  refreshProgressSummary();

  // Auto-load: first in-progress video (annotated, no status set),
  // jump to its last labeled frame, start paused
  const inProgress = state.videos.find(v => v.annotated && !v.status);
  if (inProgress) {
    await loadVideo(inProgress.id, { startPaused: true, jumpToLastLabel: true });
  }
}

init();
