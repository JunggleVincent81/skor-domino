const STORAGE_KEY = 'domino-round-analyzer-v1';
const DOUBLE_MAX = 6;
const TOTAL_TILES = ((DOUBLE_MAX + 1) * (DOUBLE_MAX + 2)) / 2;
const ALL_TILES = buildAllTiles();

let state = loadState();
let roundUndoStack = [];
let resultUndoStack = [];
let toastTimer = null;

const uiState = {
  playPlayerId: state.config.myPlayerId,
  playTileId: null,
  playSide: 'auto',
  setupDraft: null,
};

syncSetupDraftFromState();
recomputePlayerStats();
renderAll();
bindStaticEvents();

function buildAllTiles() {
  const tiles = [];
  for (let a = 0; a <= DOUBLE_MAX; a += 1) {
    for (let b = a; b <= DOUBLE_MAX; b += 1) {
      tiles.push({ id: `${a}-${b}`, a, b });
    }
  }
  return tiles;
}

function defaultPlayers(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: index === 0 ? 'Saya' : `Lawan ${index}`,
    losses: 0,
    currentLosingStreak: 0,
    maxLosingStreak: 0,
  }));
}

function createRound(number, players, startingHandSize) {
  const handCounts = {};
  players.forEach((player) => {
    handCounts[player.id] = startingHandSize;
  });

  return {
    number,
    startedAt: new Date().toISOString(),
    myHand: [],
    handCounts,
    openEnds: null,
    actions: [],
    playedTiles: [],
    passEvents: [],
    chain: [],
  };
}

function createDefaultState() {
  const players = defaultPlayers(4);
  return {
    version: 1,
    config: {
      gameName: 'Domino Analyzer',
      startingHandSize: 7,
      myPlayerId: players[0].id,
    },
    players,
    round: createRound(1, players, 7),
    history: {
      roundResults: [],
    },
    updatedAt: new Date().toISOString(),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    console.error(error);
    return createDefaultState();
  }
}

function normalizeState(input) {
  const fallback = createDefaultState();
  if (!input || !Array.isArray(input.players) || !input.config) {
    return fallback;
  }

  const players = input.players.map((player, index) => ({
    id: player.id || `p${index + 1}`,
    name: player.name || (index === 0 ? 'Saya' : `Lawan ${index}`),
    losses: Number(player.losses) || 0,
    currentLosingStreak: Number(player.currentLosingStreak) || 0,
    maxLosingStreak: Number(player.maxLosingStreak) || 0,
  }));

  const startingHandSize = clampNumber(Number(input.config.startingHandSize) || 7, 1, TOTAL_TILES);
  const myPlayerId = players.some((player) => player.id === input.config.myPlayerId)
    ? input.config.myPlayerId
    : players[0].id;

  const roundInput = input.round || {};
  const round = createRound(
    clampNumber(Number(roundInput.number) || (input.history?.roundResults?.length || 0) + 1, 1, 9999),
    players,
    startingHandSize,
  );

  round.myHand = Array.isArray(roundInput.myHand)
    ? roundInput.myHand.filter((tileId) => ALL_TILES.some((tile) => tile.id === tileId))
    : [];
  round.openEnds = Array.isArray(roundInput.openEnds) && roundInput.openEnds.length === 2
    ? [Number(roundInput.openEnds[0]), Number(roundInput.openEnds[1])]
    : null;
  round.actions = Array.isArray(roundInput.actions) ? roundInput.actions : [];
  round.playedTiles = Array.isArray(roundInput.playedTiles) ? roundInput.playedTiles : [];
  round.passEvents = Array.isArray(roundInput.passEvents) ? roundInput.passEvents : [];
  round.chain = Array.isArray(roundInput.chain) ? roundInput.chain : [];

  if (roundInput.handCounts && typeof roundInput.handCounts === 'object') {
    players.forEach((player) => {
      const value = Number(roundInput.handCounts[player.id]);
      round.handCounts[player.id] = Number.isFinite(value)
        ? clampNumber(value, 0, TOTAL_TILES)
        : startingHandSize;
    });
  }

  const history = {
    roundResults: Array.isArray(input.history?.roundResults) ? input.history.roundResults : [],
  };

  return {
    version: 1,
    config: {
      gameName: input.config.gameName || 'Domino Analyzer',
      startingHandSize,
      myPlayerId,
    },
    players,
    round,
    history,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function persistState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTile(tileId) {
  return ALL_TILES.find((tile) => tile.id === tileId);
}

function getPlayer(playerId) {
  return state.players.find((player) => player.id === playerId);
}

function getMyPlayer() {
  return getPlayer(state.config.myPlayerId);
}

function tileContains(tile, pip) {
  return tile.a === pip || tile.b === pip;
}

function uniqueNumbers(values) {
  return [...new Set(values)];
}

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch (error) {
    return isoString;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getPlayedTileIdsSet() {
  return new Set(state.round.playedTiles.map((item) => item.tileId));
}

function getUnknownTiles() {
  const playedSet = getPlayedTileIdsSet();
  const myHandSet = new Set(state.round.myHand);
  return ALL_TILES.filter((tile) => !playedSet.has(tile.id) && !myHandSet.has(tile.id));
}

function countPipsFromTileIds(tileIds) {
  const counts = {};
  for (let pip = 0; pip <= DOUBLE_MAX; pip += 1) {
    counts[pip] = 0;
  }

  tileIds.forEach((tileId) => {
    const tile = getTile(tileId);
    if (!tile) {
      return;
    }
    counts[tile.a] += 1;
    counts[tile.b] += 1;
  });

  return counts;
}

function getPlayedPipCounts() {
  return countPipsFromTileIds(state.round.playedTiles.map((item) => item.tileId));
}

function getMyHandPipCounts() {
  return countPipsFromTileIds(state.round.myHand);
}

function getUnknownPipCounts() {
  return countPipsFromTileIds(getUnknownTiles().map((tile) => tile.id));
}

function getForbiddenMap() {
  const map = {};
  state.players.forEach((player) => {
    map[player.id] = new Set();
  });

  state.round.passEvents.forEach((event) => {
    uniqueNumbers(event.openEnds || []).forEach((pip) => {
      if (map[event.playerId]) {
        map[event.playerId].add(pip);
      }
    });
  });

  return map;
}

function getCandidateTilesForPlayer(playerId) {
  if (playerId === state.config.myPlayerId) {
    return state.round.myHand.map((tileId) => getTile(tileId)).filter(Boolean);
  }

  const forbidden = getForbiddenMap()[playerId] || new Set();
  return getUnknownTiles().filter((tile) => !forbidden.has(tile.a) && !forbidden.has(tile.b));
}

function getStockSize() {
  return TOTAL_TILES - state.players.length * state.config.startingHandSize;
}

function getPlayablePlacements(tile, openEnds) {
  if (!openEnds) {
    return [
      {
        side: 'start',
        oriented: [tile.a, tile.b],
        newOpen: [tile.a, tile.b],
      },
    ];
  }

  const [left, right] = openEnds;
  const placements = [];

  if (tileContains(tile, left)) {
    const other = tile.a === left ? tile.b : tile.a;
    placements.push({
      side: 'left',
      oriented: [other, left],
      newOpen: [other, right],
    });
  }

  if (tileContains(tile, right)) {
    const other = tile.a === right ? tile.b : tile.a;
    placements.push({
      side: 'right',
      oriented: [right, other],
      newOpen: [left, other],
    });
  }

  return placements;
}

function choosePlacement(placements, requestedSide) {
  if (!placements.length) {
    return null;
  }

  if (requestedSide === 'left' || requestedSide === 'right') {
    return placements.find((placement) => placement.side === requestedSide) || null;
  }

  if (placements.length === 1) {
    return placements[0];
  }

  const uniqueOutcomes = new Set(placements.map((placement) => placement.newOpen.join('-')));
  if (uniqueOutcomes.size === 1) {
    return placements[0];
  }

  return null;
}

function pushRoundUndoState() {
  roundUndoStack.push(deepClone(state.round));
  if (roundUndoStack.length > 40) {
    roundUndoStack.shift();
  }
}

function showToast(message, tone = 'info') {
  const toast = document.getElementById('toast');
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3200);
}

function syncSetupDraftFromState() {
  uiState.setupDraft = {
    gameName: state.config.gameName,
    playerCount: state.players.length,
    startingHandSize: state.config.startingHandSize,
    myPlayerId: state.config.myPlayerId,
    playerNames: state.players.map((player) => player.name),
  };
}

function ensureSetupDraftValidity() {
  if (!uiState.setupDraft) {
    syncSetupDraftFromState();
  }

  uiState.setupDraft.playerCount = clampNumber(Number(uiState.setupDraft.playerCount) || 4, 2, 6);
  uiState.setupDraft.startingHandSize = clampNumber(Number(uiState.setupDraft.startingHandSize) || 7, 1, TOTAL_TILES);

  const targetLength = uiState.setupDraft.playerCount;
  const defaults = defaultPlayers(targetLength).map((player) => player.name);
  uiState.setupDraft.playerNames = Array.from({ length: targetLength }, (_, index) => {
    return uiState.setupDraft.playerNames?.[index]?.trim() || defaults[index];
  });

  const availableIds = Array.from({ length: targetLength }, (_, index) => `p${index + 1}`);
  if (!availableIds.includes(uiState.setupDraft.myPlayerId)) {
    uiState.setupDraft.myPlayerId = 'p1';
  }
}

function bindStaticEvents() {
  document.addEventListener('click', handleDelegatedClicks);

  document.getElementById('applyPlayersBtn').addEventListener('click', applyPlayersFromDraft);
  document.getElementById('newRoundBtn').addEventListener('click', startNewRoundManually);
  document.getElementById('demoBtn').addEventListener('click', loadDemoData);
  document.getElementById('clearMyHandBtn').addEventListener('click', clearMyHand);
  document.getElementById('logPlayBtn').addEventListener('click', handleLogPlay);
  document.getElementById('logPassBtn').addEventListener('click', handleLogPass);
  document.getElementById('undoRoundActionBtn').addEventListener('click', undoRoundAction);
  document.getElementById('undoLastRoundBtn').addEventListener('click', undoLastRoundResult);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('resetAllBtn').addEventListener('click', resetAllData);

  document.getElementById('importFileInput').addEventListener('change', handleImportFile);
  document.getElementById('gameNameInput').addEventListener('input', (event) => {
    uiState.setupDraft.gameName = event.target.value;
    renderSetupInfoPreview();
  });
  document.getElementById('startingHandSizeInput').addEventListener('input', (event) => {
    uiState.setupDraft.startingHandSize = clampNumber(Number(event.target.value) || 7, 1, TOTAL_TILES);
    renderSetupInfoPreview();
  });
  document.getElementById('myPlayerSelect').addEventListener('change', (event) => {
    uiState.setupDraft.myPlayerId = event.target.value;
    renderSetupInfoPreview();
  });
  document.getElementById('playerCountInput').addEventListener('change', (event) => {
    uiState.setupDraft.playerCount = clampNumber(Number(event.target.value) || 4, 2, 6);
    ensureSetupDraftValidity();
    renderSetup();
  });
  document.getElementById('playPlayerSelect').addEventListener('change', (event) => {
    uiState.playPlayerId = event.target.value;
  });
  document.getElementById('playTileSelect').addEventListener('change', (event) => {
    uiState.playTileId = event.target.value;
  });
  document.getElementById('playSideSelect').addEventListener('change', (event) => {
    uiState.playSide = event.target.value;
  });

  document.getElementById('playerNameInputs').addEventListener('input', (event) => {
    const input = event.target.closest('[data-player-index]');
    if (!input) {
      return;
    }
    const index = Number(input.dataset.playerIndex);
    uiState.setupDraft.playerNames[index] = input.value;
  });
}

function handleDelegatedClicks(event) {
  const button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }

  const { action, tileId, playerId, delta } = button.dataset;

  if (action === 'toggle-my-hand') {
    toggleMyHandTile(tileId);
    return;
  }

  if (action === 'adjust-hand') {
    adjustHandCount(playerId, Number(delta));
    return;
  }

  if (action === 'record-loss') {
    recordLossForPlayer(playerId);
  }
}

function saveAndRender(message, tone = 'success') {
  persistState();
  renderAll();
  if (message) {
    showToast(message, tone);
  }
}

function renderAll() {
  recomputePlayerStats();
  ensureSetupDraftValidity();
  renderHeroStats();
  renderSetup();
  renderMyHandSection();
  renderBoardSection();
  renderAnalysisSection();
  renderScoreSection();
}

function renderHeroStats() {
  const leader = getLeaderNames();
  const worst = getMostLossNames();
  const streak = getLongestStreakNames();
  const lastRound = state.history.roundResults.at(-1);

  const stats = [
    {
      label: 'Ronde selesai',
      value: state.history.roundResults.length,
    },
    {
      label: 'Ronde aktif',
      value: `#${state.round.number}`,
    },
    {
      label: 'Pemimpin sementara',
      value: leader.length ? leader.join(', ') : '-',
    },
    {
      label: 'Kalah terbanyak',
      value: worst.length ? worst.join(', ') : '-',
    },
    {
      label: 'Kalah beruntun terpanjang',
      value: streak.length ? streak.join(', ') : '-',
    },
    {
      label: 'Loser ronde terakhir',
      value: lastRound ? getPlayer(lastRound.loserId)?.name || '-' : 'Belum ada',
    },
  ];

  document.getElementById('heroStats').innerHTML = stats
    .map(
      (item) => `
        <div class="hero-stat">
          <small>${escapeHtml(item.label)}</small>
          <strong>${escapeHtml(String(item.value))}</strong>
        </div>
      `,
    )
    .join('');
}

function renderSetup() {
  ensureSetupDraftValidity();

  const gameNameInput = document.getElementById('gameNameInput');
  const playerCountInput = document.getElementById('playerCountInput');
  const startingHandSizeInput = document.getElementById('startingHandSizeInput');
  const myPlayerSelect = document.getElementById('myPlayerSelect');
  const playerNameInputs = document.getElementById('playerNameInputs');

  gameNameInput.value = uiState.setupDraft.gameName;

  playerCountInput.innerHTML = Array.from({ length: 5 }, (_, index) => index + 2)
    .map((count) => `<option value="${count}" ${count === uiState.setupDraft.playerCount ? 'selected' : ''}>${count} pemain</option>`)
    .join('');

  startingHandSizeInput.value = uiState.setupDraft.startingHandSize;

  myPlayerSelect.innerHTML = Array.from({ length: uiState.setupDraft.playerCount }, (_, index) => {
    const playerId = `p${index + 1}`;
    return `<option value="${playerId}" ${playerId === uiState.setupDraft.myPlayerId ? 'selected' : ''}>Posisi ${index + 1}</option>`;
  }).join('');

  playerNameInputs.innerHTML = uiState.setupDraft.playerNames
    .map(
      (name, index) => `
        <label>
          Nama pemain ${index + 1}
          <input type="text" data-player-index="${index}" value="${escapeHtml(name)}" placeholder="Nama pemain ${index + 1}" />
        </label>
      `,
    )
    .join('');

  renderSetupInfoPreview();
}

function renderSetupInfoPreview() {
  ensureSetupDraftValidity();
  const info = document.getElementById('setupInfo');
  const badge = document.getElementById('setupBadge');
  const dealt = uiState.setupDraft.playerCount * uiState.setupDraft.startingHandSize;
  const stock = TOTAL_TILES - dealt;
  const myPosition = Number(uiState.setupDraft.myPlayerId.replace('p', ''));

  let stockMessage = '';
  let badgeClass = 'badge';

  if (stock < 0) {
    stockMessage = 'Kombinasi jumlah pemain dan tangan awal terlalu besar. Total kartu melebihi 28.';
    badgeClass = 'badge danger';
  } else if (stock === 0) {
    stockMessage = 'Semua 28 kartu habis terbagi. Estimasi lawan jadi paling tajam.';
    badgeClass = 'badge accent';
  } else {
    stockMessage = `Ada stok / kartu sisa di luar tangan pemain sebanyak ${stock} kartu. Estimasi lawan tetap berguna, tapi lebih longgar.`;
    badgeClass = 'badge warn';
  }

  badge.className = badgeClass;
  badge.textContent = `${uiState.setupDraft.playerCount} pemain • ${uiState.setupDraft.startingHandSize} kartu awal`;
  info.innerHTML = `
    <p><strong>Preview setup.</strong> Posisi kamu berada di kursi ${myPosition}. ${stockMessage}</p>
    <p class="muted">Setelah roster diterapkan, skor dan history lama akan direset agar konsisten dengan daftar pemain baru.</p>
  `;
}

function renderMyHandSection() {
  const expected = state.config.startingHandSize;
  const selected = state.round.myHand.length;
  const accuracyText = selected === expected
    ? 'Tanganmu lengkap. Analisa akan lebih presisi.'
    : `Baru ${selected} dari ${expected} kartu yang diinput. Isi semua kartu awal agar estimasi lawan makin akurat.`;

  document.getElementById('myHandBadge').textContent = `${selected} / ${expected} kartu terinput`;
  document.getElementById('myHandStats').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Pemain saya</div>
      <div class="kpi-value">${escapeHtml(getMyPlayer().name)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Kartu terpilih</div>
      <div class="kpi-value">${selected}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Target tangan awal</div>
      <div class="kpi-value">${expected}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Catatan</div>
      <div class="kpi-value small">${escapeHtml(accuracyText)}</div>
    </div>
  `;

  const playedSet = getPlayedTileIdsSet();
  const myHandSet = new Set(state.round.myHand);

  document.getElementById('myHandPicker').innerHTML = ALL_TILES.map((tile) => {
    const selectedClass = myHandSet.has(tile.id) ? 'is-selected' : '';
    const playedClass = playedSet.has(tile.id) ? 'is-played is-disabled' : '';
    const disabled = playedSet.has(tile.id) ? 'disabled' : '';
    const aria = myHandSet.has(tile.id) ? 'aria-pressed="true"' : 'aria-pressed="false"';
    return `
      <button
        type="button"
        class="tile-chip ${selectedClass} ${playedClass}"
        data-action="toggle-my-hand"
        data-tile-id="${tile.id}"
        ${disabled}
        ${aria}
      >
        ${dominoInnerHTML(tile.a, tile.b, tile.id)}
      </button>
    `;
  }).join('');
}

function renderBoardSection() {
  renderPlaySelectors();
  renderBoardState();
  renderHandCountControls();
  renderActionLog();
}

function renderPlaySelectors() {
  const playPlayerSelect = document.getElementById('playPlayerSelect');
  const playTileSelect = document.getElementById('playTileSelect');
  const playSideSelect = document.getElementById('playSideSelect');
  const availableTiles = ALL_TILES.filter((tile) => !getPlayedTileIdsSet().has(tile.id));

  if (!state.players.some((player) => player.id === uiState.playPlayerId)) {
    uiState.playPlayerId = state.config.myPlayerId;
  }

  playPlayerSelect.innerHTML = state.players
    .map(
      (player) => `<option value="${player.id}" ${player.id === uiState.playPlayerId ? 'selected' : ''}>${escapeHtml(player.name)}</option>`,
    )
    .join('');

  if (!availableTiles.some((tile) => tile.id === uiState.playTileId)) {
    uiState.playTileId = availableTiles[0]?.id || null;
  }

  playTileSelect.innerHTML = availableTiles.length
    ? availableTiles
        .map((tile) => {
          const mineFlag = state.round.myHand.includes(tile.id) ? ' • tangan saya' : '';
          return `<option value="${tile.id}" ${tile.id === uiState.playTileId ? 'selected' : ''}>${tile.id}${mineFlag}</option>`;
        })
        .join('')
    : '<option value="">Tidak ada kartu tersisa</option>';

  playSideSelect.value = uiState.playSide;
}

function renderBoardState() {
  const badge = document.getElementById('boardBadge');
  const boardState = document.getElementById('boardState');
  const boardChain = document.getElementById('boardChain');

  if (!state.round.openEnds) {
    badge.textContent = 'Board masih kosong';
    badge.className = 'badge';
  } else {
    badge.textContent = `Ujung board: ${state.round.openEnds[0]} | ${state.round.openEnds[1]}`;
    badge.className = 'badge accent';
  }

  boardState.innerHTML = `
    <span class="mini-badge">Ronde #${state.round.number}</span>
    <span class="mini-badge accent">Kartu keluar: ${state.round.playedTiles.length}</span>
    <span class="mini-badge">Pass tercatat: ${state.round.passEvents.length}</span>
    <span class="mini-badge warn">Sisa tak terlihat: ${getUnknownTiles().length}</span>
  `;

  if (!state.round.chain.length) {
    boardChain.innerHTML = '<div class="empty-state summary-box">Belum ada kartu di atas board. Kamu bisa mulai dari kartu pembuka mana saja.</div>';
    return;
  }

  boardChain.innerHTML = state.round.chain.map((item) => {
    const owner = getPlayer(item.playerId);
    return `
      <div class="chain-item">
        <div class="domino-view played">
          ${dominoInnerHTML(item.oriented[0], item.oriented[1], item.tileId)}
        </div>
        <div class="chain-owner">${escapeHtml(owner?.name || '-')}</div>
      </div>
    `;
  }).join('');
}

function renderHandCountControls() {
  const container = document.getElementById('handCountControls');
  const myPlayerId = state.config.myPlayerId;

  container.innerHTML = state.players.map((player) => {
    const knownCount = state.round.handCounts[player.id] ?? 0;
    const extra = player.id === myPlayerId
      ? `<div class="small muted">Kartu yang kamu input: ${state.round.myHand.length}</div>`
      : `<div class="small muted">Kandidat kartu: ${getCandidateTilesForPlayer(player.id).length}</div>`;

    return `
      <div class="hand-count-card info-box">
        <div class="hand-count-head">
          <div>
            <div class="hand-count-title">${escapeHtml(player.name)}</div>
            <div class="small muted">Jumlah kartu tersisa pemain ini</div>
          </div>
          ${player.id === myPlayerId ? '<span class="mini-badge accent">Saya</span>' : ''}
        </div>
        <div class="hand-adjust">
          <button type="button" class="adjust-btn" data-action="adjust-hand" data-player-id="${player.id}" data-delta="-1">−</button>
          <div class="hand-count-number">${knownCount}</div>
          <button type="button" class="adjust-btn" data-action="adjust-hand" data-player-id="${player.id}" data-delta="1">+</button>
        </div>
        ${extra}
      </div>
    `;
  }).join('');
}

function renderActionLog() {
  const actionLog = document.getElementById('actionLog');

  if (!state.round.actions.length) {
    actionLog.innerHTML = '<div class="empty-state summary-box">Belum ada aksi. Gunakan tombol catat kartu keluar atau pass.</div>';
    return;
  }

  actionLog.innerHTML = [...state.round.actions]
    .reverse()
    .map((action) => {
      const playerName = getPlayer(action.playerId)?.name || '-';
      if (action.type === 'play') {
        const beforeText = action.beforeEnds ? `${action.beforeEnds[0]} | ${action.beforeEnds[1]}` : 'awal ronde';
        const afterText = `${action.afterEnds[0]} | ${action.afterEnds[1]}`;
        return `
          <div class="log-item">
            <div class="log-head">
              <strong>T${action.turn} • ${escapeHtml(playerName)} memainkan ${escapeHtml(action.tileId)}</strong>
              <span class="small muted">${formatTime(action.timestamp)}</span>
            </div>
            <div class="meta">Board: ${escapeHtml(beforeText)} → ${escapeHtml(afterText)} • sisi ${escapeHtml(action.side)}</div>
          </div>
        `;
      }
      return `
        <div class="log-item">
          <div class="log-head">
            <strong>T${action.turn} • ${escapeHtml(playerName)} pass</strong>
            <span class="small muted">${formatTime(action.timestamp)}</span>
          </div>
          <div class="meta">Tidak bisa jalan pada ujung ${action.openEnds[0]} | ${action.openEnds[1]}</div>
        </div>
      `;
    })
    .join('');
}

function renderAnalysisSection() {
  renderRoundInsights();
  renderPipTable();
  renderTilePools();
  renderOpponentEstimates();
  renderRecommendations();
}

function renderRoundInsights() {
  const insightContainer = document.getElementById('roundInsights');
  const unknownTiles = getUnknownTiles();
  const unknownPips = getUnknownPipCounts();
  const passCounts = Array.from({ length: DOUBLE_MAX + 1 }, (_, pip) => ({
    pip,
    count: state.round.passEvents.reduce((total, event) => total + (event.openEnds.includes(pip) ? 1 : 0), 0),
  }));
  const topPassed = passCounts
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 2)
    .map((item) => `${item.pip} (${item.count}x)`)
    .join(', ') || 'Belum ada';

  const scarce = Object.entries(unknownPips)
    .sort((left, right) => left[1] - right[1])
    .slice(0, 2)
    .map(([pip, count]) => `${pip} (${count})`)
    .join(', ');

  const cards = [
    {
      label: 'Ronde aktif',
      value: `#${state.round.number}`,
    },
    {
      label: 'Kartu sudah keluar',
      value: state.round.playedTiles.length,
    },
    {
      label: 'Sisa kartu tak terlihat',
      value: unknownTiles.length,
    },
    {
      label: 'Ujung board',
      value: state.round.openEnds ? `${state.round.openEnds[0]} | ${state.round.openEnds[1]}` : 'Belum ada',
    },
    {
      label: 'Angka paling tipis',
      value: scarce || '-',
    },
    {
      label: 'Angka paling sering dipass',
      value: topPassed,
    },
  ];

  document.getElementById('analysisBadge').textContent = `Unknown pool: ${unknownTiles.length} kartu`;

  insightContainer.innerHTML = cards
    .map(
      (item) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(item.label)}</div>
          <div class="metric-value">${escapeHtml(String(item.value))}</div>
        </div>
      `,
    )
    .join('');
}

function renderPipTable() {
  const played = getPlayedPipCounts();
  const myHand = getMyHandPipCounts();
  const unknown = getUnknownPipCounts();

  const rows = Array.from({ length: DOUBLE_MAX + 1 }, (_, pip) => {
    const control = played[pip] + myHand[pip];
    const controlPercent = Math.round((control / 8) * 100);
    return `
      <tr>
        <td><strong>${pip}</strong></td>
        <td>${played[pip]}</td>
        <td>${myHand[pip]}</td>
        <td>${unknown[pip]}</td>
        <td>${controlPercent}%</td>
        <td>
          <div class="progress-line"><span style="width: ${controlPercent}%"></span></div>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('pipTableWrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Angka</th>
            <th>Sudah keluar</th>
            <th>Di tangan saya</th>
            <th>Belum terlihat</th>
            <th>Kontrol</th>
            <th>Bar</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderTilePools() {
  const unknownTiles = getUnknownTiles();
  const playedSet = getPlayedTileIdsSet();
  const myHandSet = new Set(state.round.myHand);

  document.getElementById('unknownTiles').innerHTML = unknownTiles.length
    ? unknownTiles.map((tile) => `<div class="domino-view">${dominoInnerHTML(tile.a, tile.b, tile.id)}</div>`).join('')
    : '<div class="empty-state summary-box">Tidak ada kartu tak terlihat. Semua kartu sudah diketahui.</div>';

  document.getElementById('allTilesGrid').innerHTML = ALL_TILES.map((tile) => {
    let classes = 'unknown';
    if (playedSet.has(tile.id)) {
      classes = 'played';
    } else if (myHandSet.has(tile.id)) {
      classes = 'mine';
    }

    return `<div class="domino-view ${classes}">${dominoInnerHTML(tile.a, tile.b, tile.id)}</div>`;
  }).join('');
}

function renderOpponentEstimates() {
  const container = document.getElementById('opponentEstimates');
  const myPlayerId = state.config.myPlayerId;
  const forbiddenMap = getForbiddenMap();
  const stock = getStockSize();

  const cards = state.players
    .filter((player) => player.id !== myPlayerId)
    .map((player) => {
      const candidates = getCandidateTilesForPlayer(player.id);
      const handCount = state.round.handCounts[player.id] ?? 0;
      const forbidden = [...forbiddenMap[player.id]];
      const ratio = candidates.length ? Math.min(100, Math.round((handCount / candidates.length) * 100)) : 0;
      const responseCount = state.round.openEnds
        ? candidates.filter((tile) => state.round.openEnds.some((end) => tileContains(tile, end))).length
        : candidates.length;

      const pipFrequency = Array.from({ length: DOUBLE_MAX + 1 }, (_, pip) => ({
        pip,
        count: candidates.reduce((total, tile) => total + (tileContains(tile, pip) ? 1 : 0), 0),
      }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 3)
        .filter((item) => item.count > 0)
        .map((item) => `${item.pip} (${item.count})`)
        .join(', ');

      const warning = candidates.length < handCount && stock === 0
        ? '<div class="analysis-note"><p><strong>Peringatan.</strong> Jumlah kandidat lebih kecil dari jumlah kartu tersisa. Cek log pass atau hitungan tangan.</p></div>'
        : '';

      const tilesHtml = candidates.length
        ? `<div class="tile-grid compact">${candidates.map((tile) => `<div class="domino-view">${dominoInnerHTML(tile.a, tile.b, tile.id)}</div>`).join('')}</div>`
        : '<div class="empty-state summary-box">Belum ada kandidat kartu.</div>';

      return `
        <div class="estimate-card info-box">
          <div class="estimate-head">
            <div>
              <div class="estimate-title">${escapeHtml(player.name)}</div>
              <div class="small muted">Estimasi berdasarkan kartu keluar + event pass</div>
            </div>
            <span class="mini-badge">${handCount} kartu</span>
          </div>

          <div class="chip-row">
            <span class="mini-chip">Kandidat: ${candidates.length}</span>
            <span class="mini-chip">Respons ke board saat ini: ${responseCount}</span>
            <span class="mini-chip">Rasio kasar per kandidat: ${ratio}%</span>
          </div>

          <div class="analysis-note" style="margin-top: 12px;">
            <p><strong>Angka yang kemungkinan sudah habis di tangan ${escapeHtml(player.name)}:</strong> ${forbidden.length ? forbidden.join(', ') : 'belum ada petunjuk pass'}.</p>
            <p><strong>Angka yang paling sering muncul di kandidat:</strong> ${pipFrequency || 'belum cukup data'}.</p>
          </div>

          ${warning}
          <div style="margin-top: 12px;">${tilesHtml}</div>
        </div>
      `;
    });

  container.innerHTML = cards.join('') || '<div class="empty-state summary-box">Belum ada lawan untuk dianalisa.</div>';
}

function renderRecommendations() {
  const attackSuggestions = document.getElementById('attackSuggestions');
  const keepSuggestions = document.getElementById('keepSuggestions');
  const myHandTiles = state.round.myHand.map((tileId) => getTile(tileId)).filter(Boolean);

  if (!myHandTiles.length) {
    const note = '<div class="empty-state summary-box">Isi kartu di tanganmu terlebih dulu supaya rekomendasi serangan dan keep bisa dihitung.</div>';
    attackSuggestions.innerHTML = note;
    keepSuggestions.innerHTML = note;
    return;
  }

  const moves = getMyAttackMoves();
  const attackByTile = {};
  moves.forEach((move) => {
    attackByTile[move.tileId] = Math.max(attackByTile[move.tileId] || -Infinity, move.score);
  });

  if (!moves.length) {
    attackSuggestions.innerHTML = '<div class="empty-state summary-box">Tidak ada kartu di tanganmu yang cocok dengan ujung board saat ini.</div>';
  } else {
    attackSuggestions.innerHTML = moves.slice(0, 5).map((move, index) => {
      const title = state.round.openEnds
        ? `${move.tileId} ke sisi ${move.side}`
        : `${move.tileId} sebagai pembuka`;
      return recommendationItemHTML(index + 1, title, move.score, move.reasons, `Ujung baru: ${move.newOpen[0]} | ${move.newOpen[1]}`);
    }).join('');
  }

  const keeps = myHandTiles
    .map((tile) => scoreKeepTile(tile.id, attackByTile[tile.id] || 0))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  keepSuggestions.innerHTML = keeps.map((item, index) => {
    return recommendationItemHTML(index + 1, item.tileId, item.score, item.reasons, 'Simpan dulu bila belum butuh tekanan langsung.');
  }).join('');
}

function getMyAttackMoves() {
  const moves = [];
  const forbiddenMap = getForbiddenMap();
  const opponents = state.players.filter((player) => player.id !== state.config.myPlayerId);
  const currentPlayed = new Set(state.round.playedTiles.map((item) => item.tileId));

  state.round.myHand.forEach((tileId) => {
    const tile = getTile(tileId);
    if (!tile) {
      return;
    }
    const placements = getPlayablePlacements(tile, state.round.openEnds);
    placements.forEach((placement) => {
      const myHandAfter = state.round.myHand.filter((id) => id !== tileId);
      const myAfterPips = countPipsFromTileIds(myHandAfter);
      const playedAfter = new Set(currentPlayed);
      playedAfter.add(tileId);
      const unknownAfter = ALL_TILES.filter((candidate) => !playedAfter.has(candidate.id) && !myHandAfter.includes(candidate.id));
      const unknownAfterPips = countPipsFromTileIds(unknownAfter.map((candidate) => candidate.id));
      const uniqueEnds = uniqueNumbers(placement.newOpen);

      let score = 0;
      const reasons = [];

      uniqueEnds.forEach((end) => {
        const lackingPlayers = opponents.filter((player) => forbiddenMap[player.id]?.has(end));
        if (lackingPlayers.length) {
          score += lackingPlayers.length * 3.2;
          reasons.push(`${lackingPlayers.map((player) => player.name).join(', ')} pernah pass pada angka ${end}`);
        }

        const support = myAfterPips[end] || 0;
        if (support > 0) {
          score += support * 1.4;
          reasons.push(`kamu masih punya ${support} dukungan angka ${end}`);
        } else {
          score -= 0.8;
        }

        const unseen = unknownAfterPips[end] || 0;
        score += Math.max(0, 5 - unseen) * 1.2;
        if (unseen <= 2) {
          reasons.push(`angka ${end} tinggal ${unseen} kali tak terlihat`);
        }
      });

      opponents.forEach((player) => {
        const candidates = getCandidateTilesForPlayer(player.id);
        const responseCount = candidates.filter((candidate) => placement.newOpen.some((end) => tileContains(candidate, end))).length;
        if (responseCount === 0) {
          score += 4;
          reasons.push(`${player.name} kemungkinan besar buntu pada ujung baru ini`);
        } else {
          score -= responseCount * 0.2;
        }
      });

      if (tile.a === tile.b) {
        score += 0.7;
        reasons.push('double bisa mengunci tempo bila angkanya tipis');
      }

      moves.push({
        tileId,
        score: Number(score.toFixed(2)),
        side: placement.side,
        newOpen: placement.newOpen,
        reasons: uniqueNumbers(reasons).slice(0, 4),
      });
    });
  });

  return moves.sort((left, right) => right.score - left.score);
}

function scoreKeepTile(tileId, bestAttackScore) {
  const tile = getTile(tileId);
  const forbiddenMap = getForbiddenMap();
  const opponents = state.players.filter((player) => player.id !== state.config.myPlayerId);
  const unknownPips = getUnknownPipCounts();
  const myPips = getMyHandPipCounts();
  const pips = uniqueNumbers([tile.a, tile.b]);
  let score = 0;
  const reasons = [];

  pips.forEach((pip) => {
    const weakOpponents = opponents.filter((player) => forbiddenMap[player.id]?.has(pip));
    if (weakOpponents.length) {
      score += weakOpponents.length * 2.2;
      reasons.push(`angka ${pip} sudah lemah di ${weakOpponents.map((player) => player.name).join(', ')}`);
    }

    const unseen = unknownPips[pip] || 0;
    if (unseen <= 3) {
      score += (4 - unseen) * 1.5;
      reasons.push(`angka ${pip} makin langka: sisa tak terlihat ${unseen}`);
    }

    const support = myPips[pip] || 0;
    if (support <= 2) {
      score += 0.8;
      reasons.push(`dukungan angka ${pip} di tanganmu tidak banyak`);
    }
  });

  if (tile.a === tile.b) {
    score += 0.9;
    reasons.push('double layak disimpan untuk tekanan akhir atau penutup');
  }

  score -= bestAttackScore * 0.35;

  return {
    tileId,
    score: Number(score.toFixed(2)),
    reasons: uniqueNumbers(reasons).slice(0, 4),
  };
}

function recommendationItemHTML(rank, title, score, reasons, footnote) {
  return `
    <div class="recommendation-item">
      <h4>
        <span>#${rank} • ${escapeHtml(title)}</span>
        <span class="mini-badge accent">Skor ${escapeHtml(String(score))}</span>
      </h4>
      <ul class="reason-list">
        ${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}
      </ul>
      <div class="small muted" style="margin-top: 10px;">${escapeHtml(footnote)}</div>
    </div>
  `;
}

function renderScoreSection() {
  renderScoreboard();
  renderLossButtons();
  renderGameSummary();
  renderHistoryTable();
}

function renderScoreboard() {
  const leaderSet = new Set(getLeaderNames());
  const worstSet = new Set(getMostLossNames());

  document.getElementById('scoreboard').innerHTML = `
    <div class="table-wrap">
      <table class="score-table">
        <thead>
          <tr>
            <th>Pemain</th>
            <th>Kalah</th>
            <th>Streak saat ini</th>
            <th>Streak terpanjang</th>
            <th>Kartu ronde aktif</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${state.players.map((player) => {
            let status = 'Netral';
            if (leaderSet.has(player.name)) {
              status = 'Memimpin';
            }
            if (worstSet.has(player.name) && state.history.roundResults.length) {
              status = 'Rawan kalah';
            }
            return `
              <tr>
                <td><strong>${escapeHtml(player.name)}</strong>${player.id === state.config.myPlayerId ? ' <span class="mini-badge accent">Saya</span>' : ''}</td>
                <td>${player.losses}</td>
                <td>${player.currentLosingStreak}</td>
                <td>${player.maxLosingStreak}</td>
                <td>${state.round.handCounts[player.id] ?? 0}</td>
                <td>${escapeHtml(status)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  const scoreBadge = document.getElementById('scoreBadge');
  scoreBadge.className = state.history.roundResults.length ? 'badge accent' : 'badge';
  scoreBadge.textContent = state.history.roundResults.length
    ? `${state.history.roundResults.length} ronde sudah tersimpan`
    : 'Belum ada hasil ronde';
}

function renderLossButtons() {
  document.getElementById('lossButtons').innerHTML = state.players
    .map(
      (player) => `
        <button type="button" data-action="record-loss" data-player-id="${player.id}">
          + kalah • ${escapeHtml(player.name)}
        </button>
      `,
    )
    .join('');
}

function renderGameSummary() {
  const summary = document.getElementById('gameSummary');
  const leaderNames = getLeaderNames();
  const worstNames = getMostLossNames();
  const streakNames = getLongestStreakNames();
  const lastRound = state.history.roundResults.at(-1);
  const bestMove = getMyAttackMoves()[0];
  const topPassed = getMostPassedNumbers();

  const paragraphs = [];

  paragraphs.push(
    `<p><strong>Pemenang sementara:</strong> ${escapeHtml(leaderNames.join(', ') || 'semua masih imbang')} dengan jumlah kalah paling sedikit.</p>`,
  );

  if (state.history.roundResults.length) {
    paragraphs.push(
      `<p><strong>Paling sering kalah:</strong> ${escapeHtml(worstNames.join(', '))}. Ini adalah kandidat yang saat ini paling tertinggal berdasarkan total ronde kalah.</p>`,
    );
    paragraphs.push(
      `<p><strong>Kalah beruntun terpanjang:</strong> ${escapeHtml(streakNames.join(', '))}. Gunakan info ini untuk membaca pemain yang sedang panas atau sedang tertekan.</p>`,
    );
  } else {
    paragraphs.push('<p>Belum ada history ronde. Klik <strong>+ kalah</strong> untuk mulai merekam perjalanan permainan.</p>');
  }

  if (lastRound) {
    paragraphs.push(
      `<p><strong>Ronde terakhir:</strong> ${escapeHtml(getPlayer(lastRound.loserId)?.name || '-')} kalah pada ronde #${lastRound.roundNumber} (${escapeHtml(formatTime(lastRound.timestamp))}).</p>`,
    );
  }

  if (topPassed.length) {
    paragraphs.push(
      `<p><strong>Angka yang paling sering bikin orang pass:</strong> ${escapeHtml(topPassed.join(', '))}. Ini bisa jadi poros serangan berikutnya.</p>`,
    );
  }

  if (bestMove) {
    const opening = state.round.openEnds ? 'serangan terbaik saat ini' : 'pembuka terbaik saat ini';
    paragraphs.push(
      `<p><strong>Analisa ronde aktif:</strong> ${opening} condong ke <strong>${escapeHtml(bestMove.tileId)}</strong> karena ${escapeHtml(bestMove.reasons[0] || 'punya skor strategi tertinggi')}.</p>`,
    );
  } else if (state.round.myHand.length) {
    paragraphs.push('<p><strong>Analisa ronde aktif:</strong> tanganmu sudah terinput, tetapi belum ada serangan valid untuk kondisi board sekarang.</p>');
  }

  summary.innerHTML = `<div class="summary-box">${paragraphs.join('')}</div>`;
}

function renderHistoryTable() {
  const history = document.getElementById('historyTable');
  const derivedHistory = getDerivedHistory();

  if (!derivedHistory.length) {
    history.innerHTML = '<div class="empty-state summary-box">History ronde masih kosong.</div>';
    return;
  }

  history.innerHTML = `
    <div class="table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th>Ronde</th>
            <th>Yang kalah</th>
            <th>Total kalah setelah ronde</th>
            <th>Streak saat itu</th>
            <th>Waktu</th>
          </tr>
        </thead>
        <tbody>
          ${derivedHistory.map((item) => `
            <tr>
              <td>#${item.roundNumber}</td>
              <td>${escapeHtml(item.loserName)}</td>
              <td>${item.lossAfter}</td>
              <td>${item.streakAfter}</td>
              <td>${escapeHtml(formatTime(item.timestamp))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function getDerivedHistory() {
  const losses = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  const streaks = Object.fromEntries(state.players.map((player) => [player.id, 0]));

  return state.history.roundResults.map((result) => {
    state.players.forEach((player) => {
      if (player.id === result.loserId) {
        losses[player.id] += 1;
        streaks[player.id] += 1;
      } else {
        streaks[player.id] = 0;
      }
    });

    return {
      roundNumber: result.roundNumber,
      loserName: getPlayer(result.loserId)?.name || '-',
      lossAfter: losses[result.loserId],
      streakAfter: streaks[result.loserId],
      timestamp: result.timestamp,
    };
  });
}

function recomputePlayerStats() {
  const lossMap = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  const currentStreakMap = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  const maxStreakMap = Object.fromEntries(state.players.map((player) => [player.id, 0]));

  state.history.roundResults.forEach((result) => {
    state.players.forEach((player) => {
      if (player.id === result.loserId) {
        lossMap[player.id] += 1;
        currentStreakMap[player.id] += 1;
        maxStreakMap[player.id] = Math.max(maxStreakMap[player.id], currentStreakMap[player.id]);
      } else {
        currentStreakMap[player.id] = 0;
      }
    });
  });

  state.players.forEach((player) => {
    player.losses = lossMap[player.id];
    player.currentLosingStreak = currentStreakMap[player.id];
    player.maxLosingStreak = maxStreakMap[player.id];
  });
}

function getLeaderNames() {
  if (!state.players.length) {
    return [];
  }
  const minLoss = Math.min(...state.players.map((player) => player.losses));
  return state.players.filter((player) => player.losses === minLoss).map((player) => player.name);
}

function getMostLossNames() {
  if (!state.players.length) {
    return [];
  }
  const maxLoss = Math.max(...state.players.map((player) => player.losses));
  return state.players.filter((player) => player.losses === maxLoss).map((player) => player.name);
}

function getLongestStreakNames() {
  if (!state.players.length) {
    return [];
  }
  const maxStreak = Math.max(...state.players.map((player) => player.maxLosingStreak));
  return state.players.filter((player) => player.maxLosingStreak === maxStreak).map((player) => player.name);
}

function getMostPassedNumbers() {
  const counts = Array.from({ length: DOUBLE_MAX + 1 }, (_, pip) => ({
    pip,
    count: state.round.passEvents.reduce((total, event) => total + (event.openEnds.includes(pip) ? 1 : 0), 0),
  }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)
    .map((item) => `${item.pip} (${item.count}x)`);
  return counts;
}

function dominoInnerHTML(left, right, label) {
  return `
    <div class="domino-face">
      <span class="domino-half">${left}</span>
      <span class="domino-divider"></span>
      <span class="domino-half">${right}</span>
    </div>
    <div class="domino-label mono">${escapeHtml(label)}</div>
  `;
}

function applyPlayersFromDraft() {
  ensureSetupDraftValidity();
  const dealt = uiState.setupDraft.playerCount * uiState.setupDraft.startingHandSize;
  if (dealt > TOTAL_TILES) {
    showToast('Jumlah kartu melebihi 28. Turunkan ukuran tangan awal atau jumlah pemain.', 'error');
    return;
  }

  const players = uiState.setupDraft.playerNames.map((name, index) => ({
    id: `p${index + 1}`,
    name: name.trim() || (index === 0 ? 'Saya' : `Lawan ${index}`),
    losses: 0,
    currentLosingStreak: 0,
    maxLosingStreak: 0,
  }));

  state = {
    version: 1,
    config: {
      gameName: uiState.setupDraft.gameName.trim() || 'Domino Analyzer',
      startingHandSize: uiState.setupDraft.startingHandSize,
      myPlayerId: uiState.setupDraft.myPlayerId,
    },
    players,
    round: createRound(1, players, uiState.setupDraft.startingHandSize),
    history: {
      roundResults: [],
    },
    updatedAt: new Date().toISOString(),
  };

  roundUndoStack = [];
  resultUndoStack = [];
  uiState.playPlayerId = state.config.myPlayerId;
  uiState.playTileId = null;
  uiState.playSide = 'auto';
  syncSetupDraftFromState();
  saveAndRender('Roster baru diterapkan. Skor dan history direset.', 'success');
}

function startNewRoundManually() {
  state.round = createRound(state.round.number + 1, state.players, state.config.startingHandSize);
  roundUndoStack = [];
  uiState.playPlayerId = state.config.myPlayerId;
  uiState.playTileId = null;
  uiState.playSide = 'auto';
  saveAndRender('Ronde baru dimulai tanpa mengubah skor.', 'info');
}

function toggleMyHandTile(tileId) {
  const tile = getTile(tileId);
  if (!tile) {
    return;
  }
  if (getPlayedTileIdsSet().has(tileId)) {
    showToast('Kartu ini sudah tercatat keluar, jadi tidak bisa dimasukkan ke tanganmu.', 'warn');
    return;
  }

  const current = new Set(state.round.myHand);
  if (current.has(tileId)) {
    current.delete(tileId);
  } else {
    current.add(tileId);
  }

  state.round.myHand = ALL_TILES.filter((item) => current.has(item.id)).map((item) => item.id);
  state.round.handCounts[state.config.myPlayerId] = state.round.myHand.length;
  saveAndRender('Tanganmu diperbarui.', 'success');
}

function clearMyHand() {
  state.round.myHand = [];
  state.round.handCounts[state.config.myPlayerId] = 0;
  saveAndRender('Tanganmu dikosongkan untuk ronde aktif.', 'warn');
}

function adjustHandCount(playerId, delta) {
  if (!state.round.handCounts[playerId] && state.round.handCounts[playerId] !== 0) {
    return;
  }
  pushRoundUndoState();
  state.round.handCounts[playerId] = clampNumber((state.round.handCounts[playerId] || 0) + delta, 0, TOTAL_TILES);
  saveAndRender(`Jumlah kartu ${getPlayer(playerId)?.name || ''} diperbarui.`, 'info');
}

function handleLogPlay() {
  const playerId = document.getElementById('playPlayerSelect').value;
  const tileId = document.getElementById('playTileSelect').value;
  const side = document.getElementById('playSideSelect').value;

  if (!playerId || !tileId) {
    showToast('Pilih pemain dan kartu terlebih dulu.', 'warn');
    return;
  }

  const tile = getTile(tileId);
  if (!tile) {
    showToast('Kartu tidak ditemukan.', 'error');
    return;
  }
  if (getPlayedTileIdsSet().has(tileId)) {
    showToast('Kartu ini sudah pernah dicatat keluar.', 'warn');
    return;
  }

  const placements = getPlayablePlacements(tile, state.round.openEnds);
  if (!placements.length) {
    showToast('Kartu ini tidak cocok dengan ujung board saat ini.', 'warn');
    return;
  }

  const chosen = choosePlacement(placements, side);
  if (!chosen) {
    showToast('Kartu cocok di dua sisi. Pilih sisi kiri atau kanan agar hasil board tepat.', 'warn');
    return;
  }

  pushRoundUndoState();

  const action = {
    type: 'play',
    turn: state.round.actions.length + 1,
    playerId,
    tileId,
    side: chosen.side,
    beforeEnds: state.round.openEnds ? [...state.round.openEnds] : null,
    afterEnds: [...chosen.newOpen],
    oriented: [...chosen.oriented],
    timestamp: new Date().toISOString(),
  };

  state.round.actions.push(action);
  state.round.playedTiles.push(action);
  state.round.openEnds = [...chosen.newOpen];

  if (chosen.side === 'start') {
    state.round.chain = [
      {
        tileId,
        playerId,
        oriented: [...chosen.oriented],
      },
    ];
  } else if (chosen.side === 'left') {
    state.round.chain.unshift({ tileId, playerId, oriented: [...chosen.oriented] });
  } else {
    state.round.chain.push({ tileId, playerId, oriented: [...chosen.oriented] });
  }

  state.round.handCounts[playerId] = clampNumber((state.round.handCounts[playerId] || 0) - 1, 0, TOTAL_TILES);

  if (playerId === state.config.myPlayerId) {
    state.round.myHand = state.round.myHand.filter((id) => id !== tileId);
    state.round.handCounts[playerId] = state.round.myHand.length;
  }

  uiState.playTileId = null;
  saveAndRender(`${getPlayer(playerId)?.name || 'Pemain'} memainkan ${tileId}.`, 'success');
}

function handleLogPass() {
  if (!state.round.openEnds) {
    showToast('Belum ada ujung board. Pass baru bisa dicatat setelah ada kartu pembuka.', 'warn');
    return;
  }

  const playerId = document.getElementById('playPlayerSelect').value;
  if (!playerId) {
    showToast('Pilih pemain yang pass.', 'warn');
    return;
  }

  pushRoundUndoState();

  const action = {
    type: 'pass',
    turn: state.round.actions.length + 1,
    playerId,
    openEnds: [...state.round.openEnds],
    timestamp: new Date().toISOString(),
  };

  state.round.actions.push(action);
  state.round.passEvents.push(action);
  saveAndRender(`${getPlayer(playerId)?.name || 'Pemain'} pass pada ujung ${state.round.openEnds[0]} | ${state.round.openEnds[1]}.`, 'info');
}

function undoRoundAction() {
  if (!roundUndoStack.length) {
    showToast('Belum ada aksi ronde yang bisa dibatalkan.', 'warn');
    return;
  }
  state.round = roundUndoStack.pop();
  saveAndRender('Aksi ronde terakhir dibatalkan.', 'warn');
}

function recordLossForPlayer(playerId) {
  const player = getPlayer(playerId);
  if (!player) {
    return;
  }

  resultUndoStack.push(deepClone(state));
  if (resultUndoStack.length > 20) {
    resultUndoStack.shift();
  }

  state.history.roundResults.push({
    roundNumber: state.round.number,
    loserId: playerId,
    timestamp: new Date().toISOString(),
    summary: {
      moves: state.round.playedTiles.length,
      passes: state.round.passEvents.length,
      openEnds: state.round.openEnds ? [...state.round.openEnds] : null,
    },
  });

  recomputePlayerStats();
  state.round = createRound(state.round.number + 1, state.players, state.config.startingHandSize);
  roundUndoStack = [];
  uiState.playPlayerId = state.config.myPlayerId;
  uiState.playTileId = null;
  uiState.playSide = 'auto';

  saveAndRender(`Ronde ditutup. ${player.name} mendapat +1 kalah dan ronde baru dimulai.`, 'success');
}

function undoLastRoundResult() {
  if (resultUndoStack.length) {
    state = resultUndoStack.pop();
    syncSetupDraftFromState();
    renderAll();
    persistState();
    showToast('Hasil ronde terakhir dibatalkan.', 'warn');
    return;
  }

  if (!state.history.roundResults.length) {
    showToast('Belum ada hasil ronde yang bisa dibatalkan.', 'warn');
    return;
  }

  const removed = state.history.roundResults.pop();
  recomputePlayerStats();
  state.round = createRound(removed.roundNumber, state.players, state.config.startingHandSize);
  saveAndRender('Hasil ronde terakhir dihapus. Log detail ronde sebelumnya tidak dipulihkan setelah reload.', 'warn');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const slug = state.config.gameName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'domino-analyzer';
  link.download = `${slug}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Data berhasil diexport ke JSON.', 'success');
}

function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state = normalizeState(parsed);
      roundUndoStack = [];
      resultUndoStack = [];
      uiState.playPlayerId = state.config.myPlayerId;
      uiState.playTileId = null;
      uiState.playSide = 'auto';
      syncSetupDraftFromState();
      saveAndRender('Data berhasil diimport.', 'success');
    } catch (error) {
      console.error(error);
      showToast('File JSON tidak valid.', 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  state = createDefaultState();
  roundUndoStack = [];
  resultUndoStack = [];
  uiState.playPlayerId = state.config.myPlayerId;
  uiState.playTileId = null;
  uiState.playSide = 'auto';
  syncSetupDraftFromState();
  saveAndRender('Semua data berhasil direset.', 'warn');
}

function loadDemoData() {
  const players = [
    { id: 'p1', name: 'Saya', losses: 0, currentLosingStreak: 0, maxLosingStreak: 0 },
    { id: 'p2', name: 'Budi', losses: 0, currentLosingStreak: 0, maxLosingStreak: 0 },
    { id: 'p3', name: 'Rina', losses: 0, currentLosingStreak: 0, maxLosingStreak: 0 },
    { id: 'p4', name: 'Doni', losses: 0, currentLosingStreak: 0, maxLosingStreak: 0 },
  ];

  state = {
    version: 1,
    config: {
      gameName: 'Demo Analyzer',
      startingHandSize: 7,
      myPlayerId: 'p1',
    },
    players,
    round: createRound(5, players, 7),
    history: {
      roundResults: [
        { roundNumber: 1, loserId: 'p2', timestamp: new Date(Date.now() - 86400000 * 4).toISOString() },
        { roundNumber: 2, loserId: 'p4', timestamp: new Date(Date.now() - 86400000 * 3).toISOString() },
        { roundNumber: 3, loserId: 'p4', timestamp: new Date(Date.now() - 86400000 * 2).toISOString() },
        { roundNumber: 4, loserId: 'p3', timestamp: new Date(Date.now() - 86400000).toISOString() },
      ],
    },
    updatedAt: new Date().toISOString(),
  };

  state.round.myHand = ['2-6', '3-5', '4-4'];
  state.round.handCounts = { p1: 3, p2: 4, p3: 5, p4: 7 };
  state.round.openEnds = [1, 6];
  state.round.actions = [
    {
      type: 'play',
      turn: 1,
      playerId: 'p2',
      tileId: '6-6',
      side: 'start',
      beforeEnds: null,
      afterEnds: [6, 6],
      oriented: [6, 6],
      timestamp: new Date(Date.now() - 1800000).toISOString(),
    },
    {
      type: 'play',
      turn: 2,
      playerId: 'p1',
      tileId: '5-6',
      side: 'right',
      beforeEnds: [6, 6],
      afterEnds: [6, 5],
      oriented: [6, 5],
      timestamp: new Date(Date.now() - 1700000).toISOString(),
    },
    {
      type: 'pass',
      turn: 3,
      playerId: 'p4',
      openEnds: [6, 5],
      timestamp: new Date(Date.now() - 1650000).toISOString(),
    },
    {
      type: 'play',
      turn: 4,
      playerId: 'p3',
      tileId: '0-5',
      side: 'right',
      beforeEnds: [6, 5],
      afterEnds: [6, 0],
      oriented: [5, 0],
      timestamp: new Date(Date.now() - 1600000).toISOString(),
    },
    {
      type: 'play',
      turn: 5,
      playerId: 'p2',
      tileId: '0-6',
      side: 'left',
      beforeEnds: [6, 0],
      afterEnds: [0, 0],
      oriented: [0, 6],
      timestamp: new Date(Date.now() - 1500000).toISOString(),
    },
    {
      type: 'pass',
      turn: 6,
      playerId: 'p3',
      openEnds: [0, 0],
      timestamp: new Date(Date.now() - 1450000).toISOString(),
    },
    {
      type: 'play',
      turn: 7,
      playerId: 'p1',
      tileId: '0-2',
      side: 'right',
      beforeEnds: [0, 0],
      afterEnds: [0, 2],
      oriented: [0, 2],
      timestamp: new Date(Date.now() - 1400000).toISOString(),
    },
    {
      type: 'pass',
      turn: 8,
      playerId: 'p4',
      openEnds: [0, 2],
      timestamp: new Date(Date.now() - 1300000).toISOString(),
    },
    {
      type: 'play',
      turn: 9,
      playerId: 'p2',
      tileId: '2-5',
      side: 'right',
      beforeEnds: [0, 2],
      afterEnds: [0, 5],
      oriented: [2, 5],
      timestamp: new Date(Date.now() - 1200000).toISOString(),
    },
    {
      type: 'play',
      turn: 10,
      playerId: 'p1',
      tileId: '0-1',
      side: 'left',
      beforeEnds: [0, 5],
      afterEnds: [1, 5],
      oriented: [1, 0],
      timestamp: new Date(Date.now() - 1100000).toISOString(),
    },
    {
      type: 'pass',
      turn: 11,
      playerId: 'p4',
      openEnds: [1, 5],
      timestamp: new Date(Date.now() - 1000000).toISOString(),
    },
    {
      type: 'play',
      turn: 12,
      playerId: 'p3',
      tileId: '1-5',
      side: 'right',
      beforeEnds: [1, 5],
      afterEnds: [1, 1],
      oriented: [5, 1],
      timestamp: new Date(Date.now() - 900000).toISOString(),
    },
    {
      type: 'play',
      turn: 13,
      playerId: 'p1',
      tileId: '1-6',
      side: 'right',
      beforeEnds: [1, 1],
      afterEnds: [1, 6],
      oriented: [1, 6],
      timestamp: new Date(Date.now() - 800000).toISOString(),
    },
  ];
  state.round.playedTiles = state.round.actions.filter((action) => action.type === 'play');
  state.round.passEvents = state.round.actions.filter((action) => action.type === 'pass');
  state.round.chain = [
    { tileId: '0-6', playerId: 'p2', oriented: [0, 6] },
    { tileId: '6-6', playerId: 'p2', oriented: [6, 6] },
    { tileId: '5-6', playerId: 'p1', oriented: [6, 5] },
    { tileId: '0-5', playerId: 'p3', oriented: [5, 0] },
    { tileId: '0-2', playerId: 'p1', oriented: [0, 2] },
    { tileId: '2-5', playerId: 'p2', oriented: [2, 5] },
    { tileId: '1-5', playerId: 'p3', oriented: [5, 1] },
    { tileId: '1-6', playerId: 'p1', oriented: [1, 6] },
  ];

  recomputePlayerStats();
  roundUndoStack = [];
  resultUndoStack = [];
  uiState.playPlayerId = state.config.myPlayerId;
  uiState.playTileId = null;
  uiState.playSide = 'auto';
  syncSetupDraftFromState();
  saveAndRender('Contoh data dimuat. Kamu bisa langsung mencoba analisa dan skor.', 'success');
}
