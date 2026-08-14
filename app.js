/* Global Application State */
let supabaseClient = null;
let currentUser = null;
let currentMode = '2d';
let currentFrame = 0;
let totalFrames = 60;
let isPlaying = false;
let playInterval = null;
let engine3DInitialized = false;

// Custom Features State
let backdropColor = '#0f0f15';
let isDrawingMode = false;
let isDrawing = false;
let customPaths = []; // Custom 2D drawings store
let audioTrack = null;

// Keyframes Store
let keyframes = {}; 

// 2D Canvas State
const canvas2D = document.getElementById('canvas-2d');
const ctx2D = canvas2D.getContext('2d');
let activeObject2D = { type: 'rectangle', x: 200, y: 150, width: 80, height: 80, color: '#4db5ff' };

// 3D Canvas State
let scene3D, camera3D, renderer3D, activeMesh3D;

/* --- 1. INITIALIZATION & LISTENERS --- */
window.addEventListener('DOMContentLoaded', () => {
  setupTimelineUI();
  setupDrawingListeners();
});

function resizeCanvases() {
  const container = document.querySelector('.viewport-container');
  if (!container) return;

  canvas2D.width = container.clientWidth;
  canvas2D.height = container.clientHeight;

  if (renderer3D && camera3D) {
    renderer3D.setSize(container.clientWidth, container.clientHeight);
    camera3D.aspect = container.clientWidth / container.clientHeight;
    camera3D.updateProjectionMatrix();
  }
  render2D();
}

window.addEventListener('resize', resizeCanvases);

/* --- 2. AUTHENTICATION & LOGIN --- */
function switchAuthTab(tab) {
  document.getElementById('btn-tab-personal').classList.toggle('active', tab === 'student');
  document.getElementById('btn-tab-admin').classList.toggle('active', tab === 'admin');
  document.getElementById('tab-student').classList.toggle('hidden', tab !== 'student');
  document.getElementById('tab-admin').classList.toggle('hidden', tab !== 'admin');
}

async function loginWithEmail() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value.trim();

  if (!email || !password) {
    alert("Please enter both email and password!");
    return;
  }

  if (supabaseClient) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      alert("Login Error: " + error.message);
    } else {
      currentUser = data.user;
      enterApp(currentUser.user_metadata?.full_name || currentUser.email);
    }
  } else {
    currentUser = { email: email, id: "demo-user-123" };
    enterApp(email);
  }
}

async function loginGoogle() {
  const CLIENT_ID = '1091638662919-51qtpgkslddd32e0bb3icpd685j0b040.apps.googleusercontent.com';

  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: async (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            try {
              const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
              });
              const profile = await res.json();
              currentUser = { email: profile.email, id: profile.sub };
              enterApp(profile.name || profile.email);
            } catch (e) {
              enterApp("Google User");
            }
          }
        }
      });
      client.requestAccessToken();
    } catch (e) {
      enterApp("Google User (Demo)");
    }
  } else {
    setTimeout(() => enterApp("Google User (Demo)"), 300);
  }
}

function connectSupabase() {
  const url = document.getElementById('supabase-url').value.trim();
  const key = document.getElementById('supabase-key').value.trim();

  if (!url || !key) {
    alert("Please enter both Supabase URL and Anon Key.");
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(url, key);
    document.getElementById('admin-panel-toggle').classList.remove('hidden');
    enterApp("School Admin");
  } catch (err) {
    alert("Failed to connect to Supabase.");
  }
}

function enterApp(userRole) {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-badge').innerText = userRole;

  setTimeout(() => {
    resizeCanvases();
    if (!engine3DInitialized) {
      init3DEngine();
      engine3DInitialized = true;
    }
  }, 100);
}

function logout() {
  location.reload();
}

function toggleAdminPanel() {
  document.getElementById('admin-modal').classList.toggle('hidden');
}

/* --- 3. CUSTOM COLOR & BACKDROP CONTROLS --- */
function updateObjectColor() {
  const color = document.getElementById('prop-color').value;
  activeObject2D.color = color;

  if (activeMesh3D) {
    activeMesh3D.material.color.set(color);
  }
  render2D();
}

function updateBackdropColor() {
  backdropColor = document.getElementById('prop-bg-color').value;
  canvas2D.style.backgroundColor = backdropColor;
  
  if (scene3D) {
    scene3D.background = new THREE.Color(backdropColor);
  }
  render2D();
}

/* --- 4. CUSTOM FREEHAND DRAWING SYSTEM --- */
function enableDrawMode() {
  isDrawingMode = !isDrawingMode;
  const drawBtn = document.getElementById('draw-btn');
  drawBtn.style.background = isDrawingMode ? '#2ed573' : '#2a2d3d';
  drawBtn.innerText = isDrawingMode ? '✏️ Drawing Mode: ON' : '✏️ Freehand Draw Mode';
}

function setupDrawingListeners() {
  canvas2D.addEventListener('mousedown', (e) => {
    if (!isDrawingMode || currentMode !== '2d') return;
    isDrawing = true;
    const rect = canvas2D.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    customPaths.push({
      color: activeObject2D.color,
      points: [{ x, y }]
    });
  });

  canvas2D.addEventListener('mousemove', (e) => {
    if (!isDrawing || !isDrawingMode || currentMode !== '2d') return;
    const rect = canvas2D.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const currentPath = customPaths[customPaths.length - 1];
    if (currentPath) {
      currentPath.points.push({ x, y });
      render2D();
    }
  });

  window.addEventListener('mouseup', () => isDrawing = false);
}

function clearDrawings() {
  customPaths = [];
  render2D();
}

/* --- 5. AUDIO / SOUNDTRACK SYSTEM --- */
function loadSoundtrack(event) {
  const file = event.target.files[0];
  if (!file) return;

  const audioPlayer = document.getElementById('audio-player');
  audioPlayer.src = URL.createObjectURL(file);
  audioTrack = audioPlayer;
  alert("Soundtrack loaded successfully! 🎵");
}

/* --- 6. 2D / 3D GEOMETRY ENGINE --- */
function setDimensionMode(mode) {
  currentMode = mode;
  document.getElementById('mode-2d-btn').classList.toggle('active', mode === '2d');
  document.getElementById('mode-3d-btn').classList.toggle('active', mode === '3d');
  document.getElementById('canvas-2d').classList.toggle('hidden', mode !== '2d');
  document.getElementById('canvas-3d-container').classList.toggle('hidden', mode !== '3d');
  
  document.getElementById('controls-2d').classList.toggle('hidden', mode !== '2d');
  document.getElementById('controls-3d').classList.toggle('hidden', mode !== '3d');
  document.getElementById('lbl-z').classList.toggle('hidden', mode !== '3d');

  resizeCanvases();
}

function render2D() {
  ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
  
  // Render custom freehand drawn paths
  customPaths.forEach(path => {
    if (path.points.length < 2) return;
    ctx2D.beginPath();
    ctx2D.strokeStyle = path.color;
    ctx2D.lineWidth = 4;
    ctx2D.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) {
      ctx2D.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx2D.stroke();
  });

  // Render main keyframed object
  ctx2D.fillStyle = activeObject2D.color;
  if (activeObject2D.type === 'rectangle') {
    ctx2D.fillRect(activeObject2D.x, activeObject2D.y, activeObject2D.width, activeObject2D.height);
  } else if (activeObject2D.type === 'circle') {
    ctx2D.beginPath();
    ctx2D.arc(activeObject2D.x, activeObject2D.y, activeObject2D.width / 2, 0, Math.PI * 2);
    ctx2D.fill();
  } else if (activeObject2D.type === 'star') {
    drawStar(ctx2D, activeObject2D.x, activeObject2D.y, 5, 40, 20);
  } else if (activeObject2D.type === 'text') {
    ctx2D.font = "30px Segoe UI, sans-serif";
    ctx2D.fillText("AnimaStudio", activeObject2D.x, activeObject2D.y);
  }
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = Math.PI / 2 * 3;
  let step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fill();
}

function init3DEngine() {
  const container = document.getElementById('canvas-3d-container');
  scene3D = new THREE.Scene();
  scene3D.background = new THREE.Color(backdropColor);

  camera3D = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera3D.position.z = 6;

  renderer3D = new THREE.WebGLRenderer({ antialias: true });
  renderer3D.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer3D.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(3, 4, 5).normalize();
  scene3D.add(light);
  scene3D.add(new THREE.AmbientLight(0x404040));

  add3DObject('cube');

  function animate3DLoop() {
    requestAnimationFrame(animate3DLoop);
    renderer3D.render(scene3D, camera3D);
  }
  animate3DLoop();
}

function add2DShape(type) {
  activeObject2D.type = type;
  render2D();
}

function add3DObject(type) {
  if (activeMesh3D) scene3D.remove(activeMesh3D);

  let geometry;
  switch (type) {
    case 'sphere': geometry = new THREE.SphereGeometry(1, 32, 32); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(0.8, 0.8, 2, 32); break;
    case 'torus': geometry = new THREE.TorusGeometry(1, 0.35, 16, 100); break;
    case 'pyramid': geometry = new THREE.ConeGeometry(1.2, 2, 4); break;
    case 'cube': default: geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5); break;
  }

  const material = new THREE.MeshPhongMaterial({ color: activeObject2D.color, shininess: 80 });
  activeMesh3D = new THREE.Mesh(geometry, material);
  scene3D.add(activeMesh3D);
}

function updateObjectPosition() {
  const x = parseFloat(document.getElementById('prop-x').value) || 0;
  const y = parseFloat(document.getElementById('prop-y').value) || 0;
  const z = parseFloat(document.getElementById('prop-z').value) || 0;

  if (currentMode === '2d') {
    activeObject2D.x = x;
    activeObject2D.y = y;
    render2D();
  } else if (activeMesh3D) {
    activeMesh3D.position.set(x, y, z);
  }
}

/* --- 7. TIMELINE & DYNAMIC FRAMES ENGINE --- */
function setupTimelineUI() {
  const track = document.getElementById('timeline-track');
  track.innerHTML = '';

  for (let i = 0; i < totalFrames; i++) {
    const frame = document.createElement('div');
    frame.className = `timeline-frame ${i === 0 ? 'active' : ''}`;
    frame.id = `frame-${i}`;
    frame.innerText = i;
    frame.onclick = () => selectFrame(i);
    track.appendChild(frame);
  }
}

function updateTotalFrames() {
  const val = parseInt(document.getElementById('total-frames-input').value) || 60;
  totalFrames = Math.max(10, Math.min(300, val));
  setupTimelineUI();
  
  // Re-highlight keyframes
  Object.keys(keyframes).forEach(frameIdx => {
    if (frameIdx < totalFrames) {
      document.getElementById(`frame-${frameIdx}`)?.classList.add('keyframe');
    }
  });
  
  document.getElementById('frame-counter').innerText = `Frame: ${currentFrame} / ${totalFrames}`;
}

function selectFrame(index) {
  currentFrame = index;
  document.querySelectorAll('.timeline-frame').forEach(f => f.classList.remove('active'));
  document.getElementById(`frame-${index}`)?.classList.add('active');
  document.getElementById('frame-counter').innerText = `Frame: ${currentFrame} / ${totalFrames}`;

  evaluateInterpolatedState(currentFrame);
}

function addKeyframe() {
  const posX = currentMode === '2d' ? activeObject2D.x : (activeMesh3D ? activeMesh3D.position.x : 0);
  const posY = currentMode === '2d' ? activeObject2D.y : (activeMesh3D ? activeMesh3D.position.y : 0);
  const posZ = currentMode === '3d' && activeMesh3D ? activeMesh3D.position.z : 0;

  keyframes[currentFrame] = { x: posX, y: posY, z: posZ };
  document.getElementById(`frame-${currentFrame}`).classList.add('keyframe');
}

function evaluateInterpolatedState(frame) {
  const keys = Object.keys(keyframes).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return;

  if (keyframes[frame]) {
    applyPos(keyframes[frame].x, keyframes[frame].y, keyframes[frame].z);
    return;
  }

  let prevKey = null, nextKey = null;
  for (let k of keys) {
    if (k < frame) prevKey = k;
    if (k > frame && nextKey === null) nextKey = k;
  }

  if (prevKey !== null && nextKey !== null) {
    const progress = (frame - prevKey) / (nextKey - prevKey);
    const interpX = keyframes[prevKey].x + (keyframes[nextKey].x - keyframes[prevKey].x) * progress;
    const interpY = keyframes[prevKey].y + (keyframes[nextKey].y - keyframes[prevKey].y) * progress;
    const interpZ = keyframes[prevKey].z + (keyframes[nextKey].z - keyframes[prevKey].z) * progress;

    applyPos(interpX, interpY, interpZ);
  } else if (prevKey !== null) {
    applyPos(keyframes[prevKey].x, keyframes[prevKey].y, keyframes[prevKey].z);
  }
}

function applyPos(x, y, z) {
  document.getElementById('prop-x').value = Math.round(x);
  document.getElementById('prop-y').value = Math.round(y);
  document.getElementById('prop-z').value = Math.round(z);

  if (currentMode === '2d') {
    activeObject2D.x = x;
    activeObject2D.y = y;
    render2D();
  } else if (activeMesh3D) {
    activeMesh3D.position.set(x, y, z);
  }
}

function togglePlayback() {
  isPlaying = !isPlaying;
  const playBtn = document.getElementById('play-btn');

  if (isPlaying) {
    playBtn.innerText = "⏸ Pause";
    if (audioTrack) {
      audioTrack.currentTime = (currentFrame / totalFrames) * audioTrack.duration || 0;
      audioTrack.play();
    }

    playInterval = setInterval(() => {
      currentFrame = (currentFrame + 1) % totalFrames;
      selectFrame(currentFrame);
    }, 1000 / 24);
  } else {
    playBtn.innerText = "▶ Play";
    clearInterval(playInterval);
    if (audioTrack) audioTrack.pause();
  }
}

/* --- 8. SAVE / LOAD SYSTEM --- */
async function saveProjectCloud() {
  const projectData = {
    mode: currentMode,
    keyframes: keyframes,
    object2D: activeObject2D,
    customPaths: customPaths,
    backdropColor: backdropColor,
    totalFrames: totalFrames
  };

  if (supabaseClient && currentUser) {
    const { error } = await supabaseClient
      .from('user_projects')
      .upsert({ user_id: currentUser.id, project_data: projectData });

    if (error) alert("Save failed: " + error.message);
    else alert("Project saved to cloud! ☁️");
  } else {
    localStorage.setItem('anima_project_backup', JSON.stringify(projectData));
    alert("Project saved locally!");
  }
}

async function loadProjectsCloud() {
  let savedData = null;

  if (supabaseClient && currentUser) {
    const { data } = await supabaseClient
      .from('user_projects')
      .select('project_data')
      .eq('user_id', currentUser.id)
      .single();
    if (data) savedData = data.project_data;
  } else {
    const raw = localStorage.getItem('anima_project_backup');
    if (raw) savedData = JSON.parse(raw);
  }

  if (savedData) {
    keyframes = savedData.keyframes || {};
    activeObject2D = savedData.object2D || activeObject2D;
    customPaths = savedData.customPaths || [];
    backdropColor = savedData.backdropColor || '#0f0f15';
    totalFrames = savedData.totalFrames || 60;

    document.getElementById('total-frames-input').value = totalFrames;
    document.getElementById('prop-bg-color').value = backdropColor;
    updateBackdropColor();

    updateTotalFrames();
    setDimensionMode(savedData.mode || '2d');
    alert("Saved animation project loaded! 📂");
  } else {
    alert("No saved project found!");
  }
}
