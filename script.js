const MAX_WORD_LENGTH = 1000;
const CANVAS_CHUNK_SIZE = 100;
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KEY_STATUS_PRIORITY = { absent: 1, present: 2, correct: 3 };
const KEY_STATUS_CLASSES = ['absent', 'present', 'correct'];
const creator = document.querySelector('#creator');
const game = document.querySelector('#game');
const creatorForm = document.querySelector('#creator-form');
const customWord = document.querySelector('#custom-word');
const keepSpaces = document.querySelector('#keep-spaces');
const enableGuessLimit = document.querySelector('#enable-guess-limit');
const guessLimitInput = document.querySelector('#guess-limit');
const shareResult = document.querySelector('#share-result');
const shareLink = document.querySelector('#share-link');
const creatorMessage = document.querySelector('#creator-message');
const wordValidation = document.querySelector('#word-validation');
const board = document.querySelector('#board');
const boardWrap = document.querySelector('#board-wrap');
const horizontalScrollbar = document.querySelector('#horizontal-scrollbar');
const boardScrollRange = document.querySelector('#board-scroll-range');
const historyActions = document.querySelector('#history-actions');
const copyHistory = document.querySelector('#copy-history');
const revealEndedWord = document.querySelector('#reveal-ended-word');
const gameMeta = document.querySelector('#game-meta');
const gameMessage = document.querySelector('#game-message');
const gameDock = document.querySelector('#game-dock');
const keyboard = document.querySelector('#keyboard');
const correctCount = document.querySelector('#correct-count');
const presentCount = document.querySelector('#present-count');
const absentCount = document.querySelector('#absent-count');
const boardZoom = document.querySelector('#board-zoom');
const zoomValue = document.querySelector('#zoom-value');
const allowIncomplete = document.querySelector('#allow-incomplete');
const incompleteOption = allowIncomplete.closest('.incomplete-option');
const revealWord = document.querySelector('#reveal-word');
const copyLastGuess = document.querySelector('#copy-last-guess');
let secret = '';
let latestScore = [];
let latestGuess = '';
let guessHistory = [];
let guessLimit = null;
let baseTileSize = '';
let followFrame = 0;
let followTarget = 0;
let wheelScrollFrame = 0;
let wheelScrollTarget = 0;
let keyStates = Object.create(null);
let lastActiveTile = null;
const keyboardButtons = new Map();

function normalizeWord(value, preserveSpaces = false) {
  const normalized = value.toLocaleUpperCase().replace(preserveSpaces ? /[^A-Z ]/g : /[^A-Z]/g, '');
  return preserveSpaces ? normalized.trim().replace(/ +/g, ' ') : normalized;
}

function hasOnlyLetters(value) {
  return /^[a-zA-Z ]*$/.test(value);
}

function validateCustomWord() {
  if (hasOnlyLetters(customWord.value)) {
    wordValidation.textContent = '';
    return true;
  }
  wordValidation.textContent = 'Use letters and spaces only.';
  return false;
}

function encodeWord(word) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(word)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeWord(value) {
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4);
    return normalizeWord(new TextDecoder().decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0))), true);
  } catch { return ''; }
}

function setMessage(element, message) { element.textContent = message; }

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temporary = document.createElement('textarea');
    temporary.value = text;
    document.body.append(temporary);
    temporary.select();
    document.execCommand('copy');
    temporary.remove();
  }
  setMessage(secret ? gameMessage : creatorMessage, successMessage);
}

function makeShareLink(word, limit) {
  const url = new URL(window.location.href);
  url.search = `?word=${encodeWord(word)}`;
  if (limit) url.searchParams.set('limit', limit);
  url.hash = '';
  return url.href;
}

function normalizedGuessLimit(value) {
  return Math.max(1, Math.min(9999, Number.parseInt(value, 10) || 7));
}

function scoreGuess(letters) {
  const result = Array(secret.length).fill('empty');
  const remaining = Object.create(null);
  for (const letter of secret) remaining[letter] = (remaining[letter] || 0) + 1;

  letters.forEach((letter, index) => {
    if (!letter) return;
    if (letter === secret[index]) {
      result[index] = 'correct';
      remaining[letter] -= 1;
    }
  });
  letters.forEach((letter, index) => {
    if (!letter) return;
    if (result[index] === 'correct') return;
    result[index] = 'absent';
    if (remaining[letter] > 0) { result[index] = 'present'; remaining[letter] -= 1; }
  });
  return result;
}

function renderKeyboard() {
  keyboardButtons.clear();
  keyboard.replaceChildren();
  const fragment = document.createDocumentFragment();
  KEY_ROWS.forEach((letters, rowIndex) => {
    const row = document.createElement('div');
    row.className = 'key-row';
    if (rowIndex === 2) row.append(createKey('ENTER'));
    [...letters].forEach(letter => row.append(createKey(letter)));
    if (rowIndex === 2) row.append(createKey('⌫'));
    fragment.append(row);
  });
  keyboard.append(fragment);
}

function createKey(letter) {
  const key = document.createElement('button');
  key.type = 'button'; key.className = `key${letter.length > 1 ? ' wide' : ''}`;
  key.textContent = letter; key.dataset.key = letter;
  key.addEventListener('click', () => useVirtualKey(letter));
  if (letter.length === 1) keyboardButtons.set(letter, key);
  return key;
}

function updateKeyboard(score, guess) {
  score.forEach((state, index) => {
    const letter = guess[index];
    if (letter && letter !== ' ' && (!keyStates[letter] || KEY_STATUS_PRIORITY[state] > KEY_STATUS_PRIORITY[keyStates[letter]])) keyStates[letter] = state;
  });
  keyboardButtons.forEach((key, letter) => {
    key.classList.remove(...KEY_STATUS_CLASSES);
    if (keyStates[letter]) key.classList.add(keyStates[letter]);
  });
}

function useVirtualKey(key) {
  const row = board.querySelector('.row:not([data-scored])');
  if (!row) return;
  const inputs = [...row.children];
  let input = inputs.includes(document.activeElement) ? document.activeElement : inputs.find(tile => !tile.value) || inputs.at(-1);
  if (key === 'ENTER') { submitRow(row); return; }
  if (key === '⌫') {
    if (input.value) { input.value = ''; input.classList.remove('filled'); }
    else if (input.previousElementSibling) focusTile(input.previousElementSibling, 'previousElementSibling');
    return;
  }
  input.value = key;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function tileSizeFor(length) {
  if (length > 300) return '1.15rem';
  if (length > 100) return '1.35rem';
  if (length > 60) return '1.6rem';
  if (length > 30) return '1.75rem';
  if (length > 18) return '2.15rem';
  return `${Math.min(3.35, Math.max(2.2, window.innerWidth * 0.06 / 16))}rem`;
}

function scaledTileSize() {
  return `${parseFloat(baseTileSize || tileSizeFor(secret.length)) * Number(boardZoom.value) / 100}rem`;
}

function keepTileVisible(tile) {
  const tileLeft = tile.offsetLeft;
  const tileRight = tileLeft + tile.offsetWidth;
  const viewLeft = boardWrap.scrollLeft;
  const viewRight = viewLeft + boardWrap.clientWidth;
  const padding = Math.min(tile.offsetWidth * 8, boardWrap.clientWidth * 0.45);
  if (tileLeft < viewLeft + padding || tileRight > viewRight - padding) {
    smoothlyFollowTo(Math.max(0, tileLeft - boardWrap.clientWidth * 0.25));
  }
}

function smoothlyFollowTo(left) {
  stopWheelScroll();
  const maximum = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
  followTarget = Math.max(0, Math.min(maximum, left));
  if (followFrame) return;
  const step = () => {
    const current = boardWrap.scrollLeft;
    const distance = followTarget - current;
    if (Math.abs(distance) < 0.5) {
      boardWrap.scrollLeft = followTarget;
      followFrame = 0;
      return;
    }
    const movement = Math.sign(distance) * Math.min(Math.abs(distance) * 0.16, 32);
    boardWrap.scrollLeft = current + movement;
    followFrame = requestAnimationFrame(step);
  };
  followFrame = requestAnimationFrame(step);
}

function stopHorizontalFollow() {
  if (followFrame) cancelAnimationFrame(followFrame);
  followFrame = 0;
  followTarget = boardWrap.scrollLeft;
}

function stopWheelScroll() {
  if (wheelScrollFrame) cancelAnimationFrame(wheelScrollFrame);
  wheelScrollFrame = 0;
  wheelScrollTarget = boardWrap.scrollLeft;
}

function smoothlyScrollByWheel(distance) {
  const maximum = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
  if (!wheelScrollFrame) wheelScrollTarget = boardWrap.scrollLeft;
  wheelScrollTarget = Math.max(0, Math.min(maximum, wheelScrollTarget + distance));
  if (wheelScrollFrame) return;

  const step = () => {
    const current = boardWrap.scrollLeft;
    const currentMaximum = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
    wheelScrollTarget = Math.max(0, Math.min(currentMaximum, wheelScrollTarget));
    const distanceToTarget = wheelScrollTarget - current;
    if (Math.abs(distanceToTarget) < 0.5) {
      boardWrap.scrollLeft = wheelScrollTarget;
      wheelScrollFrame = 0;
      return;
    }
    const movement = Math.sign(distanceToTarget) * Math.min(Math.abs(distanceToTarget) * 0.24, 96);
    boardWrap.scrollLeft = current + movement;
    wheelScrollFrame = requestAnimationFrame(step);
  };
  wheelScrollFrame = requestAnimationFrame(step);
}

function focusTile(tile, direction = 'nextElementSibling') {
  while (tile?.classList.contains('space')) tile = tile[direction];
  if (!tile) return;
  tile.focus({ preventScroll: true });
  keepTileVisible(tile);
}

function keepElementAboveDock(element) {
  requestAnimationFrame(() => {
    const dockHeight = gameDock.hidden ? 0 : gameDock.getBoundingClientRect().height;
    const scrollbarHeight = horizontalScrollbar.hidden ? 0 : horizontalScrollbar.getBoundingClientRect().height;
    const safeBottom = window.innerHeight - dockHeight - scrollbarHeight - 20;
    const elementBottom = element.getBoundingClientRect().bottom;
    if (elementBottom > safeBottom) window.scrollBy({ top: elementBottom - safeBottom, behavior: 'smooth' });
  });
}

function freezeScoredRow(row, inputs, score) {
  row._guess = inputs.map(input => input.value);
  row._score = score;
  row.classList.add('canvas-row');
  row.dataset.scored = 'true';
  row.setAttribute('aria-label', 'Checked guess');
  drawScoredCanvasRow(row);
  scoredRowObserver?.observe(row);
}

function appendRevealedGuess() {
  const letters = [...secret];
  const score = Array(secret.length).fill('correct');
  const row = document.createElement('div');
  row.className = 'row canvas-row';
  row.style.setProperty('--word-length', secret.length);
  row.dataset.scored = 'true';
  row.setAttribute('aria-label', 'Revealed word');
  row._guess = letters;
  row._score = score;
  drawScoredCanvasRow(row);
  board.append(row);
  scoredRowObserver?.observe(row);

  latestGuess = secret;
  latestScore = score.map((state, index) => ({ state, letter: letters[index] }));
  guessHistory.push(secret);
  copyLastGuess.disabled = false;
  correctCount.textContent = secret.replaceAll(' ', '').length;
  presentCount.textContent = '0';
  absentCount.textContent = '0';
  updateKeyboard(score, letters);
  syncHorizontalScrollbar();
  keepElementAboveDock(historyActions);
}

function getTileMetrics() {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return {
    gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap')) * rootFontSize,
    size: parseFloat(scaledTileSize()) * rootFontSize,
  };
}

function drawScoredCanvasRow(row) {
  row.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; });
  const { size, gap } = getTileMetrics();
  const pixelRatio = 1;
  const colors = getComputedStyle(document.documentElement);
  const stateColors = {
    correct: colors.getPropertyValue('--green').trim(),
    present: colors.getPropertyValue('--yellow').trim(),
    absent: colors.getPropertyValue('--gray').trim(),
    empty: '#121213',
  };
  const fragment = document.createDocumentFragment();
  row._canvasWidth = 0;
  row._canvasHeight = size;

  for (let start = 0; start < row._guess.length; start += CANVAS_CHUNK_SIZE) {
    const end = Math.min(start + CANVAS_CHUNK_SIZE, row._guess.length);
    const cellCount = end - start;
    const width = cellCount * size + Math.max(0, cellCount - 1) * gap;
    const canvas = document.createElement('canvas');
    canvas.className = 'scored-canvas';
    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(size * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${size}px`;
    canvas.setAttribute('aria-hidden', 'true');

    const context = canvas.getContext('2d');
    context.scale(pixelRatio, pixelRatio);
    context.font = `800 ${size * 0.55}px Inter, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    for (let index = start; index < end; index += 1) {
      const letter = row._guess[index];
      if (letter === ' ') continue;
      const state = row._score[index];
      const x = (index - start) * (size + gap);
      context.fillStyle = stateColors[state];
      context.fillRect(x, 0, size, size);
      if (state === 'empty') {
        context.strokeStyle = '#3a3a3c';
        context.lineWidth = 2;
        context.strokeRect(x + 1, 1, size - 2, size - 2);
      }
      context.fillStyle = '#ffffff';
      context.fillText(letter, x + size / 2, size / 2 + size * 0.02);
    }
    fragment.append(canvas);
    row._canvasWidth += width;
    if (start > 0) row._canvasWidth += gap;
  }
  row.replaceChildren(fragment);
  row._rendered = true;
}

function unloadScoredCanvasRow(row) {
  if (!row._rendered) return;
  row.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; });
  const placeholder = document.createElement('div');
  placeholder.className = 'canvas-placeholder';
  placeholder.style.width = `${row._canvasWidth}px`;
  placeholder.style.height = `${row._canvasHeight}px`;
  row.replaceChildren(placeholder);
  row._rendered = false;
}

function redrawScoredCanvasRows() {
  board.querySelectorAll('.canvas-row').forEach(row => {
    if (row._rendered) drawScoredCanvasRow(row);
    else prepareCanvasPlaceholder(row);
  });
}

const scoredRowObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const row = entry.target;
      if (entry.isIntersecting) drawScoredCanvasRow(row);
      else unloadScoredCanvasRow(row);
    });
  }, { rootMargin: '500px 0px' })
  : null;

function syncDockHeight() {
  document.documentElement.style.setProperty('--dock-height', `${gameDock.getBoundingClientRect().height}px`);
}

function syncHorizontalScrollbar() {
  const maximum = Math.max(0, Math.ceil(boardWrap.scrollWidth - boardWrap.clientWidth));
  horizontalScrollbar.hidden = maximum === 0;
  boardScrollRange.max = String(maximum);
  boardScrollRange.value = String(Math.min(Math.round(boardWrap.scrollLeft), maximum));
}

function createRow(focusFirst = false, prefix = '', insertBefore = null) {
  const row = document.createElement('div');
  row.className = 'row';
  row.style.setProperty('--word-length', secret.length);
  for (let index = 0; index < secret.length; index += 1) {
    const input = document.createElement('input');
    input.className = 'tile'; input.maxLength = 1; input.inputMode = 'text'; input.autocomplete = 'off';
    input.setAttribute('aria-label', `Guess letter ${index + 1}`);
    const isSpace = secret[index] === ' ';
    if (isSpace) { input.value = ' '; input.readOnly = true; input.classList.add('space'); input.setAttribute('aria-label', 'Word break'); }
    else input.value = prefix[index] || '';
    input.classList.toggle('filled', Boolean(input.value));
    row.append(input);
  }
  board.insertBefore(row, insertBefore);
  syncHorizontalScrollbar();
  if (focusFirst) focusTile(row.children[Math.min(prefix.length, secret.length - 1)]);
  keepElementAboveDock(row);
  return row;
}

function prepareCanvasPlaceholder(row) {
  const { size, gap } = getTileMetrics();
  row._canvasHeight = size;
  row._canvasWidth = row._guess.length * size + Math.max(0, row._guess.length - 1) * gap;
  const placeholder = document.createElement('div');
  placeholder.className = 'canvas-placeholder';
  placeholder.style.width = `${row._canvasWidth}px`;
  placeholder.style.height = `${row._canvasHeight}px`;
  row.replaceChildren(placeholder);
  row._rendered = false;
}

function createEmptyGuessRow() {
  const row = document.createElement('div');
  row.className = 'row canvas-row empty-guess-row';
  row.style.setProperty('--word-length', secret.length);
  row.dataset.scored = 'true';
  row._guess = Array(secret.length).fill('');
  row._score = Array(secret.length).fill('empty');
  row.setAttribute('aria-label', 'Unused guess');
  prepareCanvasPlaceholder(row);
  return row;
}

board.addEventListener('focusin', event => {
  if (event.target.classList.contains('tile')) {
    lastActiveTile = event.target;
    event.target.select();
  }
});

board.addEventListener('input', event => {
  const input = event.target;
  if (!input.classList.contains('tile')) return;
  input.value = normalizeWord(input.value).slice(-1);
  input.classList.toggle('filled', Boolean(input.value));
  if (input.value && input.nextElementSibling) focusTile(input.nextElementSibling);
});

board.addEventListener('keydown', event => {
  if (event.target.classList.contains('tile')) handleTileKey(event, event.target.parentElement, event.target);
});

function handleTileKey(event, row, input) {
  if (event.key === 'Backspace' && !input.value && input.previousElementSibling) focusTile(input.previousElementSibling, 'previousElementSibling');
  if (event.key === 'ArrowLeft' && input.previousElementSibling) { event.preventDefault(); focusTile(input.previousElementSibling, 'previousElementSibling'); }
  if (event.key === 'ArrowRight' && input.nextElementSibling) { event.preventDefault(); focusTile(input.nextElementSibling); }
  if (event.key === 'Enter') { event.preventDefault(); submitRow(row); }
}

function pasteIntoRow(row, startInput, text) {
  const letters = normalizeWord(text);
  if (!letters) return false;

  const inputs = [...row.children];
  let index = inputs.indexOf(startInput);
  for (const letter of letters) {
    while (inputs[index]?.readOnly) index += 1;
    if (!inputs[index]) break;
    inputs[index].value = letter;
    inputs[index].classList.add('filled');
    index += 1;
  }

  const nextInput = inputs.slice(index).find(input => !input.readOnly);
  if (nextInput) focusTile(nextInput);
  return true;
}

function submitRow(row) {
  if (row.dataset.scored) return;
  const inputs = [...row.children];
  const letters = inputs.map(input => input.value);
  if (!allowIncomplete.checked && letters.some(letter => !letter)) { setMessage(gameMessage, 'Complete every square before checking the guess.'); return; }
  const guess = letters.join('');
  const score = scoreGuess(letters);
  latestGuess = guess;
  guessHistory.push(guess);
  latestScore = score.map((state, index) => ({ state, letter: letters[index] }));
  copyLastGuess.disabled = false;
  const firstMiss = score.findIndex(state => state !== 'correct');
  const correctPrefix = letters.slice(0, firstMiss === -1 ? secret.length : firstMiss).join('');
  const statusCounts = { correct: 0, present: 0, absent: 0 };
  score.forEach((state, index) => { if (letters[index] && letters[index] !== ' ') statusCounts[state] += 1; });
  correctCount.textContent = statusCounts.correct;
  presentCount.textContent = statusCounts.present;
  absentCount.textContent = statusCounts.absent;
  updateKeyboard(score, letters);
  freezeScoredRow(row, inputs, score);
  if (guess === secret) {
    historyActions.hidden = false;
    revealEndedWord.hidden = true;
    keepElementAboveDock(historyActions);
    const guessLabel = guessHistory.length === 1 ? 'guess' : 'guesses';
    setMessage(gameMessage, `You solved it in ${guessHistory.length} ${guessLabel}!`);
  }
  else if (guessLimit && guessHistory.length >= guessLimit) {
    historyActions.hidden = false;
    revealEndedWord.hidden = false;
    keepElementAboveDock(historyActions);
    revealWord.disabled = true;
    setMessage(gameMessage, 'No guesses left.');
  }
  else {
    const nextEmptyRow = board.querySelector('.empty-guess-row');
    if (nextEmptyRow) {
      scoredRowObserver?.unobserve(nextEmptyRow);
      createRow(true, correctPrefix, nextEmptyRow);
      nextEmptyRow.remove();
    } else createRow(true, correctPrefix);
    setMessage(gameMessage, '');
  }
}

function copyCorrectPrefix() {
  const firstMiss = latestScore.findIndex(item => item.state !== 'correct');
  const uninterrupted = latestScore.slice(0, firstMiss === -1 ? latestScore.length : firstMiss).map(item => item.letter).join('');
  if (uninterrupted) copyText(uninterrupted, `Copied ${uninterrupted}.`);
}

function startGame(word, limit = null) {
  board.querySelectorAll('.canvas-row').forEach(row => scoredRowObserver?.unobserve(row));
  secret = word; guessLimit = limit; latestScore = []; latestGuess = ''; guessHistory = []; lastActiveTile = null; board.replaceChildren();
  creator.hidden = true; game.hidden = false; gameDock.hidden = false;
  syncDockHeight();
  allowIncomplete.checked = false;
  incompleteOption.hidden = Boolean(guessLimit);
  const letterCount = secret.replaceAll(' ', '').length;
  const letterLabel = letterCount === 1 ? 'letter' : 'letters';
  const guessLabel = guessLimit === 1 ? 'guess' : 'guesses';
  gameMeta.textContent = `${letterCount} ${letterLabel} · ${guessLimit || 'unlimited'} ${guessLabel}`;
  baseTileSize = tileSizeFor(secret.length);
  boardZoom.value = '175'; zoomValue.value = '175%'; zoomValue.textContent = '175%';
  board.style.setProperty('--tile-size', scaledTileSize());
  keyStates = Object.create(null); renderKeyboard();
  correctCount.textContent = '0'; presentCount.textContent = '0'; absentCount.textContent = '0';
  copyLastGuess.disabled = true;
  revealWord.disabled = false;
  historyActions.hidden = true;
  revealEndedWord.hidden = true;
  revealEndedWord.disabled = false;
  setMessage(gameMessage, '');
  createRow(true);
  if (guessLimit) {
    const emptyRows = [];
    for (let index = 1; index < guessLimit; index += 1) emptyRows.push(createEmptyGuessRow());
    board.append(...emptyRows);
    emptyRows.forEach(row => scoredRowObserver?.observe(row));
    syncHorizontalScrollbar();
  }
}

creatorForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!validateCustomWord()) return;
  const word = normalizeWord(customWord.value, keepSpaces.checked);
  if (!word) { setMessage(creatorMessage, 'Enter at least one letter.'); return; }
  if (word.length > MAX_WORD_LENGTH) { setMessage(creatorMessage, `Use ${MAX_WORD_LENGTH} letters or fewer.`); return; }
  const limit = enableGuessLimit.checked ? normalizedGuessLimit(guessLimitInput.value) : null;
  const link = makeShareLink(word, limit);
  shareLink.value = link; shareResult.hidden = false;
  setMessage(creatorMessage, 'Link ready.');
});
customWord.addEventListener('input', validateCustomWord);
enableGuessLimit.addEventListener('change', () => {
  guessLimitInput.disabled = !enableGuessLimit.checked;
  if (enableGuessLimit.checked) guessLimitInput.value = normalizedGuessLimit(guessLimitInput.value);
});
document.querySelector('#copy-link').addEventListener('click', () => copyText(shareLink.value, 'Link copied.'));
document.querySelector('#new-game').addEventListener('click', () => { history.replaceState({}, '', window.location.pathname); secret = ''; game.hidden = true; gameDock.hidden = true; horizontalScrollbar.hidden = true; creator.hidden = false; customWord.focus(); });
revealWord.addEventListener('click', () => {
  const row = board.querySelector('.row:not([data-scored])');
  if (!row) return;
  [...row.children].forEach((input, index) => {
    if (!input.readOnly) {
      input.value = secret[index];
      input.classList.toggle('filled', Boolean(input.value));
    }
  });
  submitRow(row);
  revealWord.disabled = true;
  setMessage(gameMessage, 'Word revealed.');
});
copyLastGuess.addEventListener('click', () => copyText(latestGuess, `Copied ${latestGuess}.`));
copyHistory.addEventListener('click', () => copyText(guessHistory.join('\n'), 'Guess history copied.'));
revealEndedWord.addEventListener('click', () => {
  appendRevealedGuess();
  setMessage(gameMessage, 'Word revealed.');
  revealEndedWord.disabled = true;
});
  boardZoom.addEventListener('input', () => {
  const previousMaximum = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
  const horizontalProgress = previousMaximum ? boardWrap.scrollLeft / previousMaximum : 0;
  stopHorizontalFollow();
  const percent = Number(boardZoom.value);
  zoomValue.value = `${percent}%`; zoomValue.textContent = `${percent}%`;
  board.style.setProperty('--tile-size', scaledTileSize());
  redrawScoredCanvasRows();
  requestAnimationFrame(() => {
    const nextMaximum = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
    boardWrap.scrollLeft = nextMaximum * horizontalProgress;
    followTarget = boardWrap.scrollLeft;
    syncHorizontalScrollbar();
  });
});
boardScrollRange.addEventListener('input', () => {
  stopHorizontalFollow();
  stopWheelScroll();
  boardWrap.scrollLeft = Number(boardScrollRange.value);
});
boardWrap.addEventListener('scroll', () => { boardScrollRange.value = String(Math.round(boardWrap.scrollLeft)); });
document.addEventListener('wheel', event => {
  if (!event.shiftKey || !event.deltaY || game.hidden || horizontalScrollbar.hidden) return;
  if (event.target instanceof Element && event.target.matches('input, textarea, select')) return;
  event.preventDefault();
  stopHorizontalFollow();
  smoothlyScrollByWheel(event.deltaY * 2.5);
}, { passive: false });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && secret && latestScore[0]?.state === 'correct') {
    event.preventDefault();
    copyCorrectPrefix();
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey || !/^[a-zA-Z]$/.test(event.key)) return;
  if (event.target instanceof Element && event.target.matches('input:not(.tile), textarea, [contenteditable="true"]')) return;

  const row = board.querySelector('.row:not([data-scored])');
  if (!row) return;
  const inputs = [...row.children];
  const input = inputs.includes(lastActiveTile) && !lastActiveTile.readOnly
    ? lastActiveTile
    : inputs.find(tile => !tile.value && !tile.readOnly);
  if (!input) return;

  event.preventDefault();
  focusTile(input);
  input.value = event.key.toUpperCase();
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('paste', event => {
  if (event.target instanceof Element && event.target.matches('input:not(.tile), textarea, [contenteditable="true"]')) return;

  const row = board.querySelector('.row:not([data-scored])');
  if (!row) return;
  const inputs = [...row.children];
  const startInput = inputs.includes(lastActiveTile) && !lastActiveTile.readOnly
    ? lastActiveTile
    : inputs.find(input => !input.value && !input.readOnly);
  if (!startInput) return;

  if (pasteIntoRow(row, startInput, event.clipboardData?.getData('text') || '')) event.preventDefault();
});

const encodedWord = new URLSearchParams(window.location.search).get('word');
const decodedWord = encodedWord ? decodeWord(encodedWord) : '';
const linkedGuessLimit = new URLSearchParams(window.location.search).get('limit');
if (decodedWord) startGame(decodedWord, linkedGuessLimit ? normalizedGuessLimit(linkedGuessLimit) : null);
else if (encodedWord) setMessage(creatorMessage, 'That link does not contain a valid custom word.');

new ResizeObserver(() => { syncDockHeight(); syncHorizontalScrollbar(); }).observe(gameDock);
new ResizeObserver(syncHorizontalScrollbar).observe(boardWrap);
