/* Global Application State */
let supabaseClient = null;
let currentMode = '2d'; // '2d' or '3d'
let currentFrame = 0;
const totalFrames = 60;
let isPlaying = false;
let playInterval = null;

// Animation Data Structure: { frameIndex: { posX, posY, posZ } }
let keyframes = {}; 

// 2D Engine Variables
const canvas2D = document.getElementById('canvas-2d');
const ctx2D = canvas2D.getContext('2d');
let activeObject2D = { type: 'rectangle', x: 200, y: 150, width: 80, height: 80, color: '#4db5ff' };

// 3D Engine Variables (Three.js)
let scene3D, camera3D, renderer3D, activeMesh3D;

/* --- 1. INITIALIZATION & SETUP --- */
window.onload = () => {
  resizeCanvases();
  setupTimelineUI();
  init3DEngine();
  render2D();
};

function resizeCanvases() {
  const container = document.querySelector('.viewport-container');
  canvas2D.width = container.clientWidth;
  canvas2D.height = container.clientHeight;
  if (renderer3D) {
    renderer3D.setSize(container.clientWidth, container.clientHeight);
    camera3D.aspect = container.clientWidth / container.clientHeight;
    camera3D.updateProjectionMatrix();
  }
}
window.onresize = resizeCanvases;

/* --- 2. AUTHENTICATION & ADMIN API --- */
function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('tab-personal').classList.add('hidden');
  document.getElementById('tab-admin').classList.add('hidden');

  if (tab === 'personal') {
    document.getElementById('tab-personal').classList.remove('hidden');
    event.target.classList.add('active');
  } else {
    document.getElementById('tab-admin').classList.remove('hidden');
    event.target.classList.add('active');
  }
}

function connectSupabase() {
  const url = document.getElementById('supabase-url').value;
  const key = document.getElementById('supabase-key').value;

  if (!url || !key) {
    alert("Please enter valid Supabase Credentials!");
    return;
  }
  supabaseClient = supabase.createClient(url, key);
  document.getElementById('admin-panel-toggle').classList.remove('hidden');
  enterApp("School/Business Admin");
}

document.getElementById('google-login-btn').onclick = async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signInWithOAuth({ provider: 'google' });
  } else {
    // Demo Access mode if backend not connected
    enterApp("Google User (Demo)");
  }
};

function enterApp(userRole) {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-badge').innerText = userRole;
  resizeCanvases();
}

function logout() {
  location.reload();
}

function toggleAdminPanel() {
  document.getElementById('admin-modal').classList.toggle('hidden');
}

function toggleGlobalPasswordInput() {
  const strategy = document.getElementById('password-strategy').value;
  const globalInput = document.getElementById('global-password');
  globalInput.classList.toggle('hidden', strategy !== 'global');
}

/* --- 3. BULK USER CREATION & FILE PARSING --- */
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('bulk-text-input').value = e.target.result;
  };
  reader.readAsText(file);
}

async function createSingleUser() {
  const name = document.getElementById('single-name').value;
  const email = document.getElementById('single-email').value;
  const password = document.getElementById('single-pass').value || "password123";

  await processAccountCreation([{ email, name, password }]);
}

async function processBulkImport() {
  const text = document.getElementById('bulk-text-input').value.trim();
  const strategy = document.getElementById('password-strategy').value;
  const globalPass = document.getElementById('global-password').value;

  if (!text) {
    alert("Please paste data or upload a valid text file.");
    return;
  }

  const lines = text.split('\n');
  const userList = [];

  lines.forEach(line => {
    const parts = line.split(',').map(p => p.trim());
    if (parts[0]) {
      let pwd = "password123";
      if (strategy === 'global' && globalPass) pwd = globalPass;
      else if (strategy === 'custom' && parts[2]) pwd = parts[2];

      userList.push({
        email: parts[0],
        name: parts[1] || "Student/User",
        password: pwd
      });
    }
  });

  await processAccountCreation(userList);
}

async function processAccountCreation(userList) {
  const statusMsg = document.getElementById('admin-status-msg');
  statusMsg.innerText = `Processing ${userList.length} user accounts...`;

  if (!supabaseClient) {
    statusMsg.innerText = `[Demo Mode] Successfully parsed & created ${userList.length} accounts!`;
    return;
  }

  let createdCount = 0;
  for (const user of userList) {
    const { error } = await supabaseClient.auth.signUp({
      email: user.email,
      password: user.password,
      options: { data: { full_name: user.name } }
    });
    if (!error) createdCount++;
  }

  statusMsg.innerText = `Created ${createdCount} of ${userList.length} accounts successfully!`;
}

/* --- 4. 2D AND 3D ANIMATION ENGINES --- */
function setDimensionMode(mode) {
  currentMode = mode;
  document.getElementById('mode-2d-btn').classList.toggle('active', mode === '2d');
  document.getElementById('mode-3d-btn').classList.toggle('active', mode === '3d');
  document.getElementById('canvas-2d').classList.toggle('hidden', mode !== '2d');
  document.getElementById('canvas-3d-container').classList.toggle('hidden', mode !== '3d');
  
  document.getElementById('controls-2d').classList.toggle('hidden', mode !== '2d');
  document.getElementById('controls-3d').classList.toggle('hidden', mode !== '3d');
  document.getElementById('lbl-z').classList.toggle('hidden', mode !== '3d');
}

function render2D() {
  ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
  ctx2D.fillStyle = activeObject2D.color;

  if (activeObject2D.type === 'rectangle') {
    ctx2D.fillRect(activeObject2D.x, activeObject2D.y, activeObject2D.width, activeObject2D.height);
  } else if (activeObject2D.type === 'circle') {
    ctx2D.beginPath();
    ctx2D.arc(activeObject2D.x, activeObject2D.y, activeObject2D.width / 2, 0, Math.PI * 2);
    ctx2D.fill();
  }
}

function init3DEngine() {
  const container = document.getElementById('canvas-3d-container');
  scene3D = new THREE.Scene();
  scene3D.background = new THREE.Color(0x0f0f15);

  camera3D = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera3D.position.z = 5;

  renderer3D = new THREE.WebGLRenderer({ antialias: true });
  renderer3D.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer3D.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(2, 2, 5).normalize();
  scene3D.add(light);

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

  let geometry = type === 'cube' 
    ? new THREE.BoxGeometry(1.5, 1.5, 1.5) 
    : new THREE.SphereGeometry(1, 32, 32);

  const material = new THREE.MeshPhongMaterial({ color: 0x4db5ff });
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
  } else {
    activeMesh3D.position.set(x, y, z);
  }
}

/* --- 5. TIMELINE & AUTO-TWEENING INTERPOLATION ENGINE --- */
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

function selectFrame(index) {
  currentFrame = index;
  document.querySelectorAll('.timeline-frame').forEach(f => f.classList.remove('active'));
  document.getElementById(`frame-${index}`).classList.add('active');
  document.getElementById('frame-counter').innerText = `Frame: ${currentFrame} / ${totalFrames}`;

  // Evaluate Auto-Interpolation (Tweening) for current frame
  evaluateInterpolatedState(currentFrame);
}

function addKeyframe() {
  const posX = currentMode === '2d' ? activeObject2D.x : activeMesh3D.position.x;
  const posY = currentMode === '2d' ? activeObject2D.y : activeMesh3D.position.y;
  const posZ = currentMode === '3d' ? activeMesh3D.position.z : 0;

  keyframes[currentFrame] = { x: posX, y: posY, z: posZ };
  document.getElementById(`frame-${currentFrame}`).classList.add('keyframe');
}

/* Math Engine: Interpolate (Tween) automatically between defined keyframes */
function evaluateInterpolatedState(frame) {
  const keys = Object.keys(keyframes).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return;

  // Exact keyframe match
  if (keyframes[frame]) {
    applyPos(keyframes[frame].x, keyframes[frame].y, keyframes[frame].z);
    return;
  }

  // Find surrounding keyframes for linear interpolation (Inbetweening)
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
    playInterval = setInterval(() => {
      currentFrame = (currentFrame + 1) % totalFrames;
      selectFrame(currentFrame);
    }, 1000 / 24); // 24 FPS
  } else {
    playBtn.innerText = "▶ Play";
    clearInterval(playInterval);
  }
}
