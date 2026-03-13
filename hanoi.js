const COLORS = ["#f0a500","#e05c3a","#3ab8e0","#4ecb71","#c792ea","#ff6b9d","#ffd166","#06d6a0"];
const ALL_PEGS = ["A","B","C","D"];
const MAX_LOG = 300;
const TURBO_BATCH = 500;

let pegsCount = 3;
let towers = {};
let moveGen = null;
let stepIdx = 0;
let running = false;
let paused = false;
let totalMoves = 0;
let callCount = 0;
let popupWorker = null;
let popupDiscCount = 11;

function optimalK(n) {
  return n - Math.floor((Math.sqrt(8 * n + 1) - 1) / 2);
}

const _m4 = {};
function calcMoves4(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (_m4[n] !== undefined) return _m4[n];
  const k = optimalK(n);
  return (_m4[n] = 2 * calcMoves4(k) + Math.pow(2, n - k) - 1);
}

function* gen3(n, from, to, aux, depth) {
  if (n === 0) return;
  callCount++;
  if (n === 1) {
    const disc = towers[from].pop();
    towers[to].push(disc);
    yield { disc, from, to, depth, isBase: true };
    return;
  }
  yield* gen3(n - 1, from, aux, to, depth + 1);
  const disc = towers[from].pop();
  towers[to].push(disc);
  yield { disc, from, to, depth, isBase: false };
  yield* gen3(n - 1, aux, to, from, depth + 1);
}

function* gen4(n, from, to, a1, a2, depth) {
  if (n === 0) return;
  callCount++;
  if (n === 1) {
    const disc = towers[from].pop();
    towers[to].push(disc);
    yield { disc, from, to, depth, isBase: true };
    return;
  }
  const k = optimalK(n);
  yield* gen4(k, from, a1, a2, to, depth + 1);
  yield* gen3(n - k, from, to, a2, depth + 1);
  yield* gen4(k, a1, to, from, a2, depth + 1);
}

function buildTowerHTML() {
  const wrap = document.getElementById("towersWrap");
  wrap.innerHTML = "";
  const pegs = pegsCount === 4 ? ALL_PEGS : ALL_PEGS.slice(0, 3);
  const baseW = pegsCount === 4 ? 120 : 155;
  const discW = baseW + 22;

  pegs.forEach(p => {
    const tc = document.createElement("div");
    tc.className = "tower-container";
    tc.innerHTML = `
      <div class="tower-label peg-${p}">${p}</div>
      <div style="position:relative;display:flex;flex-direction:column;align-items:center">
        <div class="tower-shaft peg-${p}"></div>
        <div class="tower-base peg-${p}" style="width:${baseW}px"></div>
        <div class="discs-stack" id="tower${p}" style="width:${discW}px"></div>
      </div>`;
    wrap.appendChild(tc);
  });
}

function renderTower(p) {
  const n = parseInt(document.getElementById("discCount").value);
  const el = document.getElementById("tower" + p);
  if (!el) return;
  el.innerHTML = "";
  const baseW = pegsCount === 4 ? 120 : 155;
  const minW = 26, maxW = baseW - 4;

  (towers[p] || []).forEach(disc => {
    const d = document.createElement("div");
    d.className = "disc";
    const color = COLORS[(disc - 1) % COLORS.length];
    const w = minW + ((disc - 1) / (n - 1 || 1)) * (maxW - minW);
    d.style.cssText = `width:${w}px;background:${color};box-shadow:0 0 8px ${color}44`;
    d.id = "disc-" + disc;
    d.textContent = disc;
    el.appendChild(d);
  });
}

function renderTowers() {
  (pegsCount === 4 ? ALL_PEGS : ALL_PEGS.slice(0, 3)).forEach(renderTower);
}

function highlightCode3(line) {
  document.querySelectorAll("#codeBlock3 .code-line").forEach(e => e.classList.remove("highlight"));
  document.getElementById("cl" + line)?.classList.add("highlight");
}

function highlightCode4(line) {
  document.querySelectorAll("#codeBlock4 .code-line").forEach(e => e.classList.remove("highlight"));
  document.getElementById("c4l" + line)?.classList.add("highlight");
}

function addLog(move, step) {
  const box = document.getElementById("logBox");
  box.querySelector(".current")?.classList.remove("current");
  if (box.children.length >= MAX_LOG) box.removeChild(box.firstChild);

  const entry = document.createElement("div");
  entry.className = "log-entry current";
  entry.innerHTML = `
    <span class="log-step">#${String(step).padStart(2, "0")}</span>
    <span class="log-msg">
      Disco <span class="disc-num">${move.disc}</span>:
      Haste <span class="from">${move.from}</span>
      → Haste <span class="to">${move.to}</span>
      ${move.isBase ? '<span style="color:var(--text-dim);font-size:0.61rem">[base]</span>' : ""}
    </span>`;
  box.appendChild(entry);
  box.scrollTop = box.scrollHeight;
}

function updateStack(move) {
  const box = document.getElementById("callStack");
  box.innerHTML = "";

  if (!move) {
    box.innerHTML = '<div style="color:var(--text-dim);font-size:0.62rem;text-align:center;margin:auto">Aguardando...</div>';
    return;
  }

  for (let d = 1; d <= Math.min(move.depth, 10); d++) {
    const frame = document.createElement("div");
    frame.className = "stack-frame" + (d === move.depth && move.isBase ? " base" : "");
    frame.textContent = pegsCount === 4
      ? `hanoi4(${move.depth - d + 1}, ${move.from}→${move.to})`
      : `hanoi(${move.depth - d + 1}, ${move.from}, ${move.to}, ?)`;
    box.appendChild(frame);
  }

  document.getElementById("statDepth").textContent = move.depth;
  document.getElementById("statCalls").textContent = callCount;
}

function setRunningState(isRunning, isDone) {
  document.getElementById("btnPlay").disabled = isRunning || isDone;
  document.getElementById("btnStep").disabled = isRunning || isDone;
  document.getElementById("btnPause").disabled = !isRunning || isDone;

  if (isRunning) {
    document.getElementById("statusText").textContent = "Executando...";
    document.getElementById("statusDot").className = "status-dot running";
  } else if (!isDone) {
    document.getElementById("statusText").textContent = `Passo ${stepIdx}/${totalMoves}`;
    document.getElementById("statusDot").className = "status-dot";
    document.getElementById("btnStep").disabled = stepIdx >= totalMoves;
  }
}

function getDelay() {
  const s = parseInt(document.getElementById("speed").value);
  return s >= 10 ? 0 : Math.round(1200 / s);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runAll() {
  running = true;
  paused = false;
  setRunningState(true);
  let completed = false;

  outer: while (running) {
    while (paused) {
      if (!running) break outer;
      await sleep(80);
    }

    const delay = getDelay();

    if (delay === 0) {
      let lastMove = null;
      for (let b = 0; b < TURBO_BATCH; b++) {
        if (!running || paused) break;
        const { value: move, done } = moveGen.next();
        if (done) { completed = true; running = false; break; }
        stepIdx++;
        lastMove = move;
        addLog(move, stepIdx);
      }
      if (lastMove) {
        document.getElementById("statMoves").textContent = stepIdx;
        document.getElementById("progress").style.width = (stepIdx / totalMoves * 100).toFixed(1) + "%";
        document.getElementById("statCalls").textContent = callCount;
        updateStack(lastMove);
        renderTowers();
      }
      await new Promise(r => setTimeout(r, 0));
    } else {
      const { value: move, done } = moveGen.next();
      if (done) { completed = true; running = false; break; }
      stepIdx++;
      updateStack(move);
      addLog(move, stepIdx);
      document.getElementById("statMoves").textContent = stepIdx;
      document.getElementById("progress").style.width = (stepIdx / totalMoves * 100).toFixed(1) + "%";
      if (pegsCount === 3) highlightCode3(move.isBase ? 3 : 7);
      else highlightCode4(move.isBase ? 2 : 5);
      renderTower(move.from);
      renderTower(move.to);
      const discEl = document.getElementById("disc-" + move.disc);
      if (discEl) {
        discEl.classList.add("flying");
        setTimeout(() => discEl.classList.remove("flying"), 450);
      }
      await sleep(delay);
    }
  }

  if (completed) {
    setRunningState(false, true);
    updateStack(null);
    renderTowers();
    document.getElementById("statusText").textContent = `✓ Concluído! ${totalMoves.toLocaleString()} movimentos.`;
    document.getElementById("statusDot").className = "status-dot done";
  }
}

async function runStep() {
  if (!moveGen || stepIdx >= totalMoves) return;
  setRunningState(false);

  const { value: move, done } = moveGen.next();
  if (done) return;
  stepIdx++;

  updateStack(move);
  addLog(move, stepIdx);
  document.getElementById("statMoves").textContent = stepIdx;
  document.getElementById("progress").style.width = (stepIdx / totalMoves * 100).toFixed(1) + "%";
  if (pegsCount === 3) highlightCode3(move.isBase ? 3 : 7);
  else highlightCode4(move.isBase ? 2 : 5);
  renderTower(move.from);
  renderTower(move.to);
  const discEl = document.getElementById("disc-" + move.disc);
  if (discEl) {
    discEl.classList.add("flying");
    setTimeout(() => discEl.classList.remove("flying"), 450);
  }
  await sleep(getDelay());

  if (stepIdx >= totalMoves) {
    setRunningState(false, true);
    document.getElementById("btnStep").disabled = true;
    updateStack(null);
  } else {
    document.getElementById("btnStep").disabled = false;
  }
}

function updateDiscOptions() {
  const sel = document.getElementById("discCount");
  const max = pegsCount === 4 ? 36 : 10;
  const current = Math.min(parseInt(sel.value) || 3, max);
  sel.innerHTML = "";
  for (let i = 2; i <= max; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    if (i === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function updateInfoBox() {
  const n = parseInt(document.getElementById("discCount").value);
  const box = document.getElementById("infoBox");

  if (pegsCount === 3) {
    box.innerHTML = `
      <h4 class="c3">Recursividade em Árvore</h4>
      Cada chamada de <span class="hl">hanoi(n)</span> gera
      <span class="hl">2 sub-chamadas</span> — antes e depois do movimento principal.<br><br>
      <h4 class="c3">Estrutura das chamadas:</h4>
      hanoi(n) → hanoi(n-1) <em>×2</em><br>
      hanoi(1) → <span class="hl">caso base</span> (sem recursão)<br><br>
      <h4 class="c3">Complexidade:</h4>
      • Tempo: <span class="hl">O(2ⁿ)</span><br>
      • Movimentos: <span class="hl">2ⁿ−1 = ${(Math.pow(2, n) - 1).toLocaleString()}</span><br>
      • Profundidade: <span class="hl">O(n) = ${n}</span>`;
  } else {
    const k = optimalK(n);
    const mov3 = Math.pow(2, n) - 1;
    box.innerHTML = `
      <h4 class="c4">Frame-Stewart (4 hastes)</h4>
      Divide o problema em <span class="hl">3 partes</span> usando
      a 4ª haste como auxiliar extra:<br><br>
      ① <span class="hl">hanoi4(k)</span>: move k discos para haste extra<br>
      ② <span class="hl">hanoi3(n-k)</span>: move n-k discos com 3 hastes<br>
      ③ <span class="hl">hanoi4(k)</span>: move k discos ao destino<br><br>
      <h4 class="c4">k ótimo para n=${n}:</h4>
      k = <span class="hl">${k}</span><br>
      fórmula: n − ⌊(√(8n+1)−1) / 2⌋<br><br>
      <h4 class="c4">Comparativo com n=${n}:</h4>
      • 3 hastes: <span class="hl">${mov3.toLocaleString()}</span> movimentos<br>
      • 4 hastes: <span class="hl">${totalMoves.toLocaleString()}</span> movimentos ✦<br>
      • Tipo: <span class="hl">recursão mista</span>`;
  }
}

function stopPopupWorker() {
  if (popupWorker) { popupWorker.terminate(); popupWorker = null; }
}

function popupResetUI() {
  document.getElementById("popExecMoves").textContent = "0";
  document.getElementById("popRate").textContent = "—";
  document.getElementById("popEta").textContent = "—";
  document.getElementById("popProgress").style.width = "0%";
  document.getElementById("popStatus").textContent = "Pronto";
  document.getElementById("popStatus").className = "pop-status-badge";
  document.getElementById("popBtnRun").disabled = false;
  document.getElementById("popBtnStop").disabled = true;
}

function openPopup() {
  popupDiscCount = 11;
  document.getElementById("popDiscSel").value = 11;
  const total = Math.pow(2, popupDiscCount) - 1;
  document.getElementById("popTotalMoves").textContent = total.toLocaleString("pt-BR");
  popupResetUI();
  document.getElementById("modalOverlay").classList.add("open");
}

function closePopup() {
  stopPopupWorker();
  document.getElementById("modalOverlay").classList.remove("open");
}

function popupSelectDisc(n) {
  stopPopupWorker();
  popupDiscCount = n;
  const total = Math.pow(2, n) - 1;
  document.getElementById("popTotalMoves").textContent = total.toLocaleString("pt-BR");
  popupResetUI();
}

function runPopup() {
  stopPopupWorker();
  const n = parseInt(document.getElementById("popDiscSel").value);
  popupDiscCount = n;
  const total = Math.pow(2, n) - 1;

  document.getElementById("popBtnRun").disabled = true;
  document.getElementById("popBtnStop").disabled = false;
  document.getElementById("popStatus").textContent = "Executando";
  document.getElementById("popStatus").className = "pop-status-badge running";
  document.getElementById("popExecMoves").textContent = "0";
  document.getElementById("popProgress").style.width = "0%";

  const REPORT = Math.max(100000, Math.floor(total / 500));

  const workerCode = `
    const TOTAL = ${total};
    const REPORT = ${REPORT};
    let count = 0;
    function hanoi(n) {
      if (n === 0) return;
      if (n === 1) { count++; if (count % REPORT === 0) postMessage({ count }); return; }
      hanoi(n - 1);
      count++; if (count % REPORT === 0) postMessage({ count });
      hanoi(n - 1);
    }
    hanoi(${n});
    postMessage({ count, done: true });
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  popupWorker = new Worker(URL.createObjectURL(blob));

  const startTime = Date.now();

  popupWorker.onmessage = ({ data }) => {
    const { count, done } = data;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = Math.round(count / elapsed);
    const pct = (count / total * 100);
    const remaining = rate > 0 ? (total - count) / rate : 0;

    document.getElementById("popExecMoves").textContent = count.toLocaleString("pt-BR");
    document.getElementById("popProgress").style.width = pct.toFixed(3) + "%";
    document.getElementById("popRate").textContent = rate.toLocaleString("pt-BR") + " mov/s";

    if (done) {
      document.getElementById("popEta").textContent = `${elapsed.toFixed(2)}s total`;
      document.getElementById("popProgress").style.width = "100%";
      document.getElementById("popStatus").textContent = "Concluído";
      document.getElementById("popStatus").className = "pop-status-badge done";
      document.getElementById("popBtnRun").disabled = false;
      document.getElementById("popBtnStop").disabled = true;
      popupWorker = null;
    } else {
      const min = Math.floor(remaining / 60);
      const sec = Math.floor(remaining % 60);
      document.getElementById("popEta").textContent = min > 0 ? `~${min}m ${sec}s` : `~${sec}s`;
    }
  };
}

function init() {
  stopPopupWorker();
  running = false;
  paused = false;
  stepIdx = 0;
  callCount = 0;
  moveGen = null;

  const n = parseInt(document.getElementById("discCount").value);
  const pegs = pegsCount === 4 ? ALL_PEGS : ALL_PEGS.slice(0, 3);

  towers = {};
  pegs.forEach(p => (towers[p] = []));
  for (let i = n; i >= 1; i--) towers.A.push(i);

  totalMoves = pegsCount === 3 ? Math.pow(2, n) - 1 : calcMoves4(n);

  moveGen = pegsCount === 3
    ? gen3(n, "A", "C", "B", 1)
    : gen4(n, "A", "C", "B", "D", 1);

  document.getElementById("statTotal").textContent = totalMoves.toLocaleString();
  document.getElementById("statMoves").textContent = "0";
  document.getElementById("statDepth").textContent = "0";
  document.getElementById("statCalls").textContent = "0";
  document.getElementById("progress").style.width = "0%";
  document.getElementById("logBox").innerHTML = "";
  document.querySelectorAll(".code-line").forEach(e => e.classList.remove("highlight"));

  updateStack(null);
  buildTowerHTML();
  renderTowers();
  updateInfoBox();
  setRunningState(false);

  document.getElementById("btnStep").disabled = false;
  document.getElementById("statusText").textContent = `${n} discos · ${pegsCount} hastes · ${totalMoves.toLocaleString()} movimentos`;
  document.getElementById("statusDot").className = "status-dot";
}

function setPegs(n) {
  running = false;
  paused = false;
  pegsCount = n;

  document.getElementById("peg3Btn").classList.toggle("active", n === 3);
  document.getElementById("peg4Btn").classList.toggle("active", n === 4);
  document.getElementById("codeBlock3").style.display = n === 3 ? "" : "none";
  document.getElementById("codeBlock4").style.display = n === 4 ? "" : "none";
  document.getElementById("algoBanner").classList.toggle("visible", n === 4);
  document.getElementById("btnOpenPopup").style.display = n === 3 ? "inline-flex" : "none";
  document.getElementById("btnPause").textContent = "⏸ Pausar";

  updateDiscOptions();
  init();
}

document.getElementById("btnPlay").addEventListener("click", runAll);
document.getElementById("btnStep").addEventListener("click", runStep);
document.getElementById("btnOpenPopup").addEventListener("click", openPopup);
document.getElementById("popBtnRun").addEventListener("click", runPopup);
document.getElementById("popBtnStop").addEventListener("click", () => {
  stopPopupWorker();
  document.getElementById("popStatus").textContent = "Parado";
  document.getElementById("popStatus").className = "pop-status-badge";
  document.getElementById("popBtnRun").disabled = false;
  document.getElementById("popBtnStop").disabled = true;
});
document.getElementById("popBtnClose").addEventListener("click", closePopup);
document.getElementById("modalOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modalOverlay")) closePopup();
});
document.getElementById("popDiscSel").addEventListener("change", function () {
  popupSelectDisc(parseInt(this.value));
});

document.getElementById("btnPause").addEventListener("click", () => {
  paused = !paused;
  const btn = document.getElementById("btnPause");
  btn.textContent = paused ? "▶ Retomar" : "⏸ Pausar";
  document.getElementById("statusText").textContent = paused ? "Pausado" : "Executando...";
  document.getElementById("statusDot").className = paused ? "status-dot" : "status-dot running";
});

document.getElementById("btnReset").addEventListener("click", () => {
  running = false;
  paused = false;
  document.getElementById("btnPause").textContent = "⏸ Pausar";
  setTimeout(init, 50);
});

document.getElementById("discCount").addEventListener("change", () => {
  running = false;
  paused = false;
  setTimeout(init, 50);
});

document.getElementById("speed").addEventListener("input", function () {
  document.getElementById("speedVal").textContent = this.value;
});

setPegs(3);
