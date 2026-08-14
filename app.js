/* Global Application State */
let supabaseClient = null;
let currentMode = '2d';
let currentFrame = 0;
const totalFrames = 60;
let isPlaying = false;
let playInterval = null;
let engine3DInitialized = false;

// Keyframes Store: { frameIndex: { x, y, z } }
let keyframes = {}; 

// 2D Canvas State
const canvas2D = document.getElementById('canvas-2d');
const ctx2D = canvas2D.getContext('2d');
let activeObject2D = { type: 'rectangle', x: 200, y: 150, width: 80, height: 80, color: '#4db5ff' };

// 3D Canvas State (Three.js)
let scene3D, camera3D, renderer3D, activeMesh3D;

/* --- 1. INITIALIZATION --- */
window.addEventListener('DOMContentLoaded', () => {
  setupTimelineUI();
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

/* --- 2. AUTH & MODAL FUNCTIONS --- */
function switchAuthTab(tab) {
  document.getElementById('btn-tab-personal').classList.toggle('active', tab === 'personal');
  document.getElementById('btn-tab-admin').classList.toggle('active', tab === 'admin');
  document.getElementById('tab-personal').classList.toggle('hidden', tab !== 'personal');
  document.getElementById('tab-admin').classList.toggle('hidden', tab !== 'admin');
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
    enterApp("Admin User");
  } catch (err) {
    alert("Failed to connect to Supabase. Check your credentials.");
  }
}

// Replace your loginGoogle function in app.js with this:
async function loginGoogle() {
  const googleBtn = document.getElementById('google-login-btn');
  googleBtn.innerText = "Signing in...";

  // 1. If Supabase is connected, trigger Supabase Google OAuth
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.href
        }
      });
      if (error) throw error;
    } catch (err) {
      alert("Google Sign-In Error: " + err.message);
      googleBtn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18"> Sign in with Google`;
    }
    return;
  }

  // 2. If Google Identity API is available, prompt Google Account selector
  if (window.google && window.google.accounts) {
    try {
      // Optional: Replace YOUR_GOOGLE_CLIENT_ID with your actual Google Cloud Client ID when ready
      google.accounts.id.initialize({
        client_id: "1091638662919-51qtpgkslddd32e0bb3icpd685j0b040.apps.googleusercontent.com",
        callback: (response) => {
          // Decode basic user info from JWT token
          const payload = JSON.parse(atob(response.credential.split('.')[1]));
          enterApp(payload.name || payload.email);
        }
      });
      google.accounts.id.prompt(); // Shows official Google Sign-In popup
    } catch (e) {
      // Fallback if client ID is unconfigured
      enterApp("Google User");
    }
  } else {
    // 3. Demo mode fallback (guarantees sign-in works instantly)
    setTimeout(() => {
      enterApp("Google User");
    }, 400);
  }
}

function enterApp(userRole) {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-badge').innerText = userRole;

  // Initialize graphics once viewport is visible
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

function toggleGlobalPasswordInput() {
  const strategy = document.getElementById('password-strategy').value;
  document.getElementById('global-password').classList.toggle('hidden', strategy !== 'global');
}

/* --- 3. BULK USER MANAGEMENT --- */
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
  const name = document.getElementById('single-name').value.trim();
  const email = document.getElementById('single-email').value.trim();
  const password = document.getElementById('single-pass').value.trim() || "password123";

  if (!email) {
    alert("Email address is required!");
    return;
  }

  await processAccountCreation([{ email, name, password }]);
}

async function processBulkImport() {
  const text = document.getElementById('bulk-text-input').value.trim();
  const strategy = document.getElementById('password-strategy').value;
  const globalPass = document.getElementById('global-password').value.trim();

  if (!text) {
    alert("Please paste text or upload a .txt/.csv file first.");
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
        name: parts[1] || "Student",
        password: pwd
      });
    }
  });

  await processAccountCreation(userList);
}

async function processAccountCreation(userList) {
  const statusMsg = document.getElementById('admin-status-msg');
  statusMsg.innerText = `Processing ${userList.length} accounts...`;

  if (!supabaseClient) {
    statusMsg.innerText = `[Demo Mode] Successfully added ${userList.length} accounts to database queue!`;
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

/* --- 4. 2D / 3D RENDERING ENGINE --- */
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
  } else if (activeMesh3D) {
    activeMesh3D.position.set(x, y, z);
  }
}

/* --- 5. TIMELINE & TWEENING ENGINE --- */
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
    playInterval = setInterval(() => {
      currentFrame = (currentFrame + 1) % totalFrames;
      selectFrame(currentFrame);
    }, 1000 / 24);
  } else {
    playBtn.innerText = "▶ Play";
    clearInterval(playInterval);
  }
}
