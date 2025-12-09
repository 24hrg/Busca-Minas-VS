const difficulties = {
  beginner: {rows:9, cols:9, mines:10},
  intermediate: {rows:16, cols:16, mines:40},
  expert: {rows:16, cols:30, mines:99}
};

const boardEl = document.getElementById('board');
const mineCounterEl = document.getElementById('mineCounter');
const timerEl = document.getElementById('timer');
const resetBtn = document.getElementById('resetBtn');
const difficultySel = document.getElementById('difficulty');
const statusEl = document.getElementById('status');
const resultModal = document.getElementById('resultModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalRestart = document.getElementById('modalRestart');
const bestTimeEl = document.getElementById('bestTime');
const leaderListEl = document.getElementById('leaderList');
const clearLeaderBtn = document.getElementById('clearLeader');
const soundToggleBtn = document.getElementById('soundToggle');
const boardContainerEl = document.getElementById('boardContainer');

// responsive cell sizing: compute a cell size that fits the board container
function computeCellSize(){
  try{
    const gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 6;
    const containerWidth = boardContainerEl.clientWidth - 32; // account for padding (18px * 2)
    if(containerWidth <= 0) return; // container not ready
    // total gaps = (cols - 1) * gap
    const totalGaps = Math.max(0, (cols - 1) * gap);
    let size = Math.floor((containerWidth - totalGaps) / cols);
    // clamp size to reasonable bounds (16-48px)
    size = Math.max(16, Math.min(48, size));
    document.documentElement.style.setProperty('--cell-size', size + 'px');
    // also set board grid template explicitly
    boardEl.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
  }catch(e){
    // fallback: use CSS var
    boardEl.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
  }
}

// debounce resize to avoid thrashing
let resizeTimeout = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(()=>{
    // small delay to ensure layout is stable
    setTimeout(computeCellSize, 100);
  }, 200);
});

// Simple WebAudio helper for short sounds
let audioCtx = null;
let soundMuted = false;
function playTone(freq = 440, time = 0.06, type = 'sine'){
  if(soundMuted) return;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    o.start(now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + time);
    o.stop(now + time + 0.02);
  }catch(e){ /* ignore */ }
}

function playEventSound(name){
  if(soundMuted) return;
  if(name==='reveal') playTone(520,0.06,'sine');
  else if(name==='flag') playTone(320,0.06,'square');
  else if(name==='win') { playTone(880,0.12,'sine'); setTimeout(()=>playTone(660,0.12,'sine'),90); }
  else if(name==='lose') playTone(160,0.18,'sawtooth');
}

// SVG faces for the reset button
const FACE_SMILE = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#0b2b47" stroke-width="1.2" fill="#fff"/><path d="M8.5 10.2h.01M15.5 10.2h.01" stroke="#0b2b47" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/><path d="M8 15.2c1.2-1 3.8-1 5 0" stroke="#0b2b47" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/></svg>`;
const FACE_WIN = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#0b2b47" stroke-width="1.2" fill="#dff7e6"/><path d="M7 13.5l2 2 6-6" stroke="#059669" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FACE_LOSE = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#0b2b47" stroke-width="1.2" fill="#ffecec"/><path d="M9 9l6 6M15 9l-6 6" stroke="#b21b1b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let rows=9, cols=9, mines=10;
let board = [];
let revealedCount = 0;
let flagsCount = 0;
let totalCells = 0;
let timer = 0, timerInterval = null;
let gameOver = false;
let firstClick = true;

function setDifficulty(key){
  const d = difficulties[key];
  rows = d.rows; cols = d.cols; mines = d.mines;
}

function startTimer(){
  clearInterval(timerInterval);
  timer = 0; timerEl.textContent = pad(timer);
  timerInterval = setInterval(()=>{timer++; timerEl.textContent = pad(timer)},1000);
}

function stopTimer(){ clearInterval(timerInterval); timerInterval = null }

function pad(num){ return String(num).padStart(3,'0') }

function initGame(){
  boardEl.innerHTML = '';
  board = [];
  revealedCount = 0; flagsCount = 0; totalCells = rows*cols; gameOver=false; firstClick=true;
  updateMineCounter();
  statusEl.textContent = 'Estado: Jugando';
  resetBtn.innerHTML = FACE_SMILE;
  updateBestTimeDisplay();
  updateLeaderUI();
  computeCellSize();
  boardEl.style.setProperty('--cols', cols);

  for(let r=0;r<rows;r++){
    board[r]=[];
    for(let c=0;c<cols;c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('tabindex','0');
      cell.dataset.r = r; cell.dataset.c = c; cell.dataset.revealed = '0'; cell.dataset.flag = '0';
      cell.addEventListener('click', onCellClick);
      cell.addEventListener('dblclick', onCellDblClick);
      cell.addEventListener('keydown', onCellKeyDown);
      // touch support: long-press to toggle flag
      cell.addEventListener('touchstart', onCellTouchStart, {passive:true});
      cell.addEventListener('touchend', onCellTouchEnd);
      cell.addEventListener('touchmove', onCellTouchMove);
      cell.addEventListener('contextmenu', onCellRightClick);
      boardEl.appendChild(cell);
      board[r][c] = {mine:false, adj:0, el:cell};
    }
  }
  stopTimer(); timerEl.textContent = pad(0);
}

function onCellKeyDown(e){
  const el = e.currentTarget; const r=+el.dataset.r, c=+el.dataset.c;
  if(e.key === 'Enter'){ e.preventDefault(); onCellClick({currentTarget:el}); return }
  if(e.key === ' ' || e.key.toLowerCase() === 'f'){ e.preventDefault(); toggleFlag(r,c); return }
  // arrow navigation
  let nr=r, nc=c;
  if(e.key === 'ArrowUp') nr = Math.max(0,r-1);
  else if(e.key === 'ArrowDown') nr = Math.min(rows-1,r+1);
  else if(e.key === 'ArrowLeft') nc = Math.max(0,c-1);
  else if(e.key === 'ArrowRight') nc = Math.min(cols-1,c+1);
  if(nr!==r || nc!==c){
    const next = board[nr][nc].el; next.focus(); e.preventDefault();
  }
}

// touch long-press implementation
let touchTimeouts = new WeakMap();
function onCellTouchStart(e){
  const el = e.currentTarget;
  const t = setTimeout(()=>{
    // toggle flag after long-press
    const r = +el.dataset.r, c = +el.dataset.c;
    if(!gameOver && el.dataset.revealed==='0') toggleFlag(r,c);
  }, 600);
  touchTimeouts.set(el, t);
}
function onCellTouchEnd(e){
  const el = e.currentTarget; const t = touchTimeouts.get(el); if(t) clearTimeout(t);
}
function onCellTouchMove(e){
  const el = e.currentTarget; const t = touchTimeouts.get(el); if(t) clearTimeout(t);
}

function onCellDblClick(e){
  if(gameOver) return;
  const el = e.currentTarget; const r=+el.dataset.r, c=+el.dataset.c;
  const cell = board[r][c];
  if(el.dataset.revealed==='0') return; // only on revealed cells
  if(cell.adj <= 0) return;
  // count flagged neighbors
  let f = 0;
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    if(dr===0 && dc===0) continue;
    const nr=r+dr, nc=c+dc;
    if(nr>=0 && nr<rows && nc>=0 && nc<cols){
      if(board[nr][nc].el.dataset.flag === '1') f++;
    }
  }
  if(f === cell.adj){
    // visual chord highlight then reveal
    const toReveal = [];
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(dr===0 && dc===0) continue;
      const nr=r+dr, nc=c+dc;
      if(nr>=0 && nr<rows && nc>=0 && nc<cols){
        const nel = board[nr][nc].el;
        if(nel.dataset.revealed==='0' && nel.dataset.flag==='0') toReveal.push([nr,nc]);
        nel.classList.add('chord');
      }
    }
    setTimeout(()=>{
      for(const [nr,nc] of toReveal) reveal(nr,nc);
      // remove chord highlight
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
        const nr=r+dr, nc=c+dc;
        if(nr>=0 && nr<rows && nc>=0 && nc<cols){ board[nr][nc].el.classList.remove('chord') }
      }
    }, 80);
  }
}

function placeMines(excludeR, excludeC){
  let placed=0;
  // Avoid placing mines on the initial cell and its neighbors to make first click safe
  const forbidden = new Set();
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    const rr = excludeR + dr, cc = excludeC + dc;
    if(rr>=0 && rr<rows && cc>=0 && cc<cols) forbidden.add(rr+":"+cc);
  }
  while(placed<mines){
    const r = Math.floor(Math.random()*rows);
    const c = Math.floor(Math.random()*cols);
    if(forbidden.has(r+":"+c) || board[r][c].mine) continue;
    board[r][c].mine = true; placed++;
  }
  // compute adjacents
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      if(board[r][c].mine){ board[r][c].adj = -1; continue }
      let count=0;
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
        if(dr===0 && dc===0) continue;
        const nr=r+dr, nc=c+dc;
        if(nr>=0 && nr<rows && nc>=0 && nc<cols && board[nr][nc].mine) count++;
      }
      board[r][c].adj = count;
    }
  }
}

function onCellClick(e){
  if(gameOver) return;
  const el = e.currentTarget; const r=+el.dataset.r, c=+el.dataset.c;
  if(firstClick){ placeMines(r,c); startTimer(); firstClick=false }
  if(el.dataset.flag === '1') return;
  reveal(r,c);
}

function onCellRightClick(e){
  e.preventDefault();
  if(gameOver) return;
  const el = e.currentTarget; if(el.dataset.revealed==='1') return;
  const r=+el.dataset.r, c=+el.dataset.c;
  toggleFlag(r,c);
}

function toggleFlag(r,c){
  const cell = board[r][c]; const el = cell.el;
  if(el.dataset.flag==='1'){ el.dataset.flag='0'; el.classList.remove('flagged'); el.textContent=''; flagsCount--; }
  else { el.dataset.flag='1'; el.classList.add('flagged'); el.textContent='🚩'; flagsCount++; }
  updateMineCounter();
  playEventSound('flag');
}

function reveal(r,c){
  const cell = board[r][c]; const el = cell.el;
  if(el.dataset.revealed==='1' || el.dataset.flag==='1') return;
  el.dataset.revealed='1'; el.classList.add('revealed'); el.classList.remove('flagged'); el.dataset.flag='0';
  if(cell.mine){
    el.classList.add('mine'); el.innerHTML = '<span class="emoji">💣</span>';
    revealAllMines();
    lose();
    return;
  }
  playEventSound('reveal');
  revealedCount++;
  if(cell.adj>0){ el.innerHTML = `<span class="num">${cell.adj}</span>`; el.classList.add('n'+cell.adj) }
  else { // flood fill
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(dr===0 && dc===0) continue;
      const nr=r+dr, nc=c+dc;
      if(nr>=0 && nr<rows && nc>=0 && nc<cols){
        const nel = board[nr][nc].el;
        if(nel.dataset.revealed==='0' && nel.dataset.flag==='0') reveal(nr,nc);
      }
    }
  }
  checkWin();
}

function revealAllMines(){
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    if(board[r][c].mine){ const el=board[r][c].el; el.classList.add('revealed','mine'); el.innerHTML='<span class="emoji">💣</span>' }
  }
}

function lose(){
  gameOver=true; stopTimer(); statusEl.textContent='Estado: Perdió'; resetBtn.innerHTML = FACE_LOSE; playEventSound('lose');
  showResult(false);
}

function checkWin(){
  if(revealedCount === totalCells - mines){
    gameOver=true; stopTimer(); statusEl.textContent='Estado: Ganó'; resetBtn.innerHTML = FACE_WIN; playEventSound('win');
    // reveal any mines as flags
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
      if(board[r][c].mine){ const el=board[r][c].el; el.innerHTML='<span class="emoji">🚩</span>'; }
    }
    // handle best time and leaderboard
    tryUpdateBestTime();
    showResult(true);
  }
}

function updateMineCounter(){
  const left = Math.max(0, mines - flagsCount);
  mineCounterEl.textContent = String(left).padStart(3,'0');
}

function resetGame(){
  firstClick=true; stopTimer(); resetBtn.innerHTML = FACE_SMILE;
  initGame();
}

resetBtn.addEventListener('click', ()=>resetGame());
difficultySel.addEventListener('change',(e)=>{
  setDifficulty(e.target.value); resetGame(); updateLeaderUI(); updateBestTimeDisplay();
});

// prevent default context menu on board
boardEl.addEventListener('contextmenu',(e)=>e.preventDefault());

// Modal controls
function showResult(won){
  modalTitle.textContent = won ? '¡Ganaste!' : 'Perdiste';
  modalMessage.textContent = won ? `Has ganado en ${timer} segundos.` : 'Has perdido. Intenta de nuevo.';
  resultModal.setAttribute('aria-hidden','false');
}
function hideResult(){ resultModal.setAttribute('aria-hidden','true') }
modalRestart.addEventListener('click', ()=>{ hideResult(); resetGame(); });

// Leaderboard (multiple entries)
function leaderKey(){ return `mines_leaders_${difficultySel.value || 'beginner'}` }
function getLeaders(){
  try{ return JSON.parse(localStorage.getItem(leaderKey()) || '[]') }catch(e){ return [] }
}
function saveLeaders(list){ localStorage.setItem(leaderKey(), JSON.stringify(list)) }
function tryUpdateBestTime(){
  const leaders = getLeaders();
  // if current timer qualifies, ask for name and save
  const entry = {name: 'Anon', time: timer};
  // check if list smaller than 5 or time is better than worst
  if(leaders.length < 5 || timer < leaders[leaders.length-1].time){
    // open name modal instead of prompt
    showNameModal(timer, (name)=>{
      if(name) entry.name = name.substring(0,12);
      leaders.push(entry);
      leaders.sort((a,b)=>a.time-b.time);
      if(leaders.length>5) leaders.length=5;
      saveLeaders(leaders);
      updateLeaderUI();
      updateBestTimeDisplay();
    });
  } else {
    updateBestTimeDisplay();
  }
}

// Name modal logic
const nameModal = document.getElementById('nameModal');
const playerNameInput = document.getElementById('playerName');
const nameSubmitBtn = document.getElementById('nameSubmit');
const nameCancelBtn = document.getElementById('nameCancel');

function showNameModal(time, cb){
  nameModal.setAttribute('aria-hidden','false');
  playerNameInput.value = '';
  playerNameInput.focus();
  const onSubmit = ()=>{
    const v = playerNameInput.value.trim() || 'Anon';
    close(); cb(v);
  };
  const onCancel = ()=>{ close(); cb(null); };
  function close(){
    nameModal.setAttribute('aria-hidden','true');
    nameSubmitBtn.removeEventListener('click', onSubmit);
    nameCancelBtn.removeEventListener('click', onCancel);
  }
  nameSubmitBtn.addEventListener('click', onSubmit);
  nameCancelBtn.addEventListener('click', onCancel);
}

function updateBestTimeDisplay(){
  const leaders = getLeaders();
  if(leaders.length>0) bestTimeEl.textContent = `${String(leaders[0].time).padStart(3,'0')}s`;
  else bestTimeEl.textContent = '—';
}

function updateLeaderUI(){
  const leaders = getLeaders();
  leaderListEl.innerHTML = '';
  if(leaders.length===0){ leaderListEl.innerHTML = '<li>—</li>'; return }
  for(const it of leaders){
    const li = document.createElement('li'); li.textContent = `${it.name} — ${it.time}s`; leaderListEl.appendChild(li);
  }
}

clearLeaderBtn.addEventListener('click', ()=>{
  if(confirm('Borrar mejores tiempos para esta dificultad?')){ localStorage.removeItem(leaderKey()); updateLeaderUI(); updateBestTimeDisplay(); }
});

// sound toggle
soundToggleBtn.addEventListener('click', ()=>{
  soundMuted = !soundMuted; soundToggleBtn.setAttribute('aria-pressed', String(soundMuted)); soundToggleBtn.textContent = soundMuted? '🔇' : '🔊';
});

// initial setup
setDifficulty(difficultySel.value);
initGame();
// compute cell size after DOM is ready
setTimeout(computeCellSize, 50);

