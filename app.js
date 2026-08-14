/* Global Application State */
let supabaseClient = null;
let currentUser = null;
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
    // Standalone Demo login
    currentUser = { email: email, id: "demo-user-123" };
    enterApp(email);
  }
}

async function loginGoogle() {
  const googleBtn = document.getElementById('google-login-btn');
  googleBtn.innerText = "Signing in...";

  // 1. If Supabase is connected, use Supabase OAuth Redirect
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href }
      });
      if (error) throw error;
      return;
    } catch (err) {
      console.warn("Supabase Google Auth failed, trying direct Google OAuth.");
    }
  }

  // 2. Direct Google OAuth Popup using your Client ID
  const CLIENT_ID = '1091638662919-51qtpgkslddd32e0bb3icpd685j0b040.apps.googleusercontent.com';

  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: async (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            // Fetch basic user profile info with access token
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
          } else {
            googleBtn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18"> Sign in with Google`;
          }
        },
        error_callback: (err) => {
          console.error("Google Auth Error:", err);
          googleBtn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18"> Sign in with Google`;
        }
      });

      // Opens standard Google sign-in popup
      client.requestAccessToken();
    } catch (e) {
      console.error("Initialization Error:", e);
      enterApp("Google User (Demo)");
    }
  } else {
    // Fallback if script didn't load
    setTimeout(() => {
      enterApp("Google User (Demo)");
    }, 300);
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

/* --- 3. CLOUD SAVE & LOAD SYSTEM --- */
async function saveProjectCloud() {
  const projectData = {
    mode: currentMode,
    keyframes: keyframes,
    object2D: activeObject2D,
    timestamp: new Date().toISOString()
  };

  if (supabaseClient && currentUser) {
    const { error } = await supabaseClient
      .from('user_projects')
      .upsert({ user_id: currentUser.id, project_data: projectData });

    if (error) {
      alert("Save failed: " + error.message);
    } else {
      alert("Project saved successfully to the cloud! ☁️");
    }
  } else {
    // Local storage backup fallback
    localStorage.setItem('anima_project_backup', JSON.stringify(projectData));
    alert("Project saved locally! (Connect Supabase for multi-device cloud saves)");
  }
}

async function loadProjectsCloud() {
  let savedData = null;

  if (supabaseClient && currentUser) {
    const { data, error } = await supabaseClient
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
    
    // Highlight saved keyframes in UI timeline
    setupTimelineUI();
    Object.keys(keyframes).forEach(frameIdx => {
      document.getElementById(`frame-${frameIdx}`)?.classList.add('keyframe');
    });

    setDimensionMode(savedData.mode || '2d');
    alert("Saved animation project loaded! 📂");
  } else {
    alert("No saved project found!");
  }
}

/* --- 4. EXPANDED 2D & 3D GEOMETRY ENGINE --- */
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
  scene3D.background = new THREE.Color(0x0f0f15);

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
    case 'sphere':
      geometry = new THREE.SphereGeometry(1, 32, 32);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.8, 0.8, 2, 32);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(1, 0.35, 16, 100);
      break;
    case 'pyramid':
      geometry = new THREE.ConeGeometry(1.2, 2, 4);
      break;
    case 'cube':
    default:
      geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      break;
  }

  const material = new THREE.MeshPhongMaterial({ color: 0x4db5ff, shininess: 80 });
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
    playInterval = setInterval(() => {
      currentFrame = (currentFrame + 1) % totalFrames;
      selectFrame(currentFrame);
    }, 1000 / 24);
  } else {
    playBtn.innerText = "▶ Play";
    clearInterval(playInterval);
  }
}

/* Admin Account Creation */
async function processAccountCreation(userList) {
  const statusMsg = document.getElementById('admin-status-msg');
  statusMsg.style.color = '#4db5ff';
  statusMsg.innerText = `Processing ${userList.length} user accounts...`;

  if (!supabaseClient) {
    setTimeout(() => {
      statusMsg.style.color = '#2ed573';
      statusMsg.innerText = `[Demo Mode] Added ${userList.length} accounts to database queue!`;
    }, 400);
    return;
  }

  let createdCount = 0;
  for (const user of userList) {
    const { data, error } = await supabaseClient.auth.signUp({
      email: user.email.trim(),
      password: user.password.trim(),
      options: { data: { full_name: user.name } }
    });
    if (!error && data?.user) createdCount++;
  }

  statusMsg.style.color = createdCount > 0 ? '#2ed573' : '#ff4757';
  statusMsg.innerText = `Created ${createdCount} of ${userList.length} account(s) successfully!`;
}
