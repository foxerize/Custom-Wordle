const MAX_WORD_LENGTH = 1000;
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KEY_STATUS_PRIORITY = { absent: 1, present: 2, correct: 3 };
const KEY_STATUS_CLASSES = ['absent', 'present', 'correct'];
const creator = document.querySelector('#creator');
const game = document.querySelector('#game');
const creatorForm = document.querySelector('#creator-form');
const customWord = document.querySelector('#custom-word');
const keepSpaces = document.querySelector('#keep-spaces');
const shareResult = document.querySelector('#share-result');
const shareLink = document.querySelector('#share-link');
const creatorMessage = document.querySelector('#creator-message');
const wordValidation = document.querySelector('#word-validation');
const board = document.querySelector('#board');
const boardWrap = document.querySelector('#board-wrap');
const historyActions = document.querySelector('#history-actions');
const copyHistory = document.querySelector('#copy-history');
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
const revealWord = document.querySelector('#reveal-word');
const copyLastGuess = document.querySelector('#copy-last-guess');
let secret = '';
let latestScore = [];
let latestGuess = '';
let guessHistory = [];
let baseTileSize = '';
let followFrame = 0;
let followTarget = 0;
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

function makeShareLink(word) {
  const url = new URL(window.location.href);
  url.search = `?word=${encodeWord(word)}`;
  url.hash = '';
  return url.href;
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
    if (result[index] !== 'correct' && remaining[letter] > 0) {
      result[index] = 'present';
      remaining[letter] -= 1;
    }
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
  followTarget = left;
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

function focusTile(tile, direction = 'nextElementSibling') {
  while (tile?.classList.contains('space')) tile = tile[direction];
  if (!tile) return;
  tile.focus({ preventScroll: true });
  keepTileVisible(tile);
}

function keepElementAboveDock(element) {
  requestAnimationFrame(() => {
    const dockHeight = gameDock.hidden ? 0 : gameDock.getBoundingClientRect().height;
    const safeBottom = window.innerHeight - dockHeight - 20;
    const elementBottom = element.getBoundingClientRect().bottom;
    if (elementBottom > safeBottom) window.scrollBy({ top: elementBottom - safeBottom, behavior: 'smooth' });
  });
}

function createRow(focusFirst = false, prefix = '') {
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
  board.append(row);
  if (focusFirst) focusTile(row.children[Math.min(prefix.length, secret.length - 1)]);
  keepElementAboveDock(row);
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
  inputs.forEach((input, index) => {
    input.classList.remove('filled');
    if (score[index] !== 'empty') input.classList.add(score[index]);
    input.readOnly = true;
  });
  row.dataset.scored = 'true';
  if (guess === secret) {
    historyActions.hidden = false;
    keepElementAboveDock(historyActions);
    setMessage(gameMessage, 'You solved it!');
  }
  else { setMessage(gameMessage, ''); createRow(true, correctPrefix); }
}

function copyCorrectPrefix() {
  const firstMiss = latestScore.findIndex(item => item.state !== 'correct');
  const uninterrupted = latestScore.slice(0, firstMiss === -1 ? latestScore.length : firstMiss).map(item => item.letter).join('');
  if (uninterrupted) copyText(uninterrupted, `Copied ${uninterrupted}.`);
}

function startGame(word) {
  secret = word; latestScore = []; latestGuess = ''; guessHistory = []; lastActiveTile = null; board.replaceChildren();
  creator.hidden = true; game.hidden = false; gameDock.hidden = false;
  gameMeta.textContent = `${secret.replaceAll(' ', '').length} letters · unlimited guesses`;
  baseTileSize = tileSizeFor(secret.length);
  boardZoom.value = '175'; zoomValue.value = '175%'; zoomValue.textContent = '175%';
  board.style.setProperty('--tile-size', scaledTileSize());
  keyStates = Object.create(null); renderKeyboard();
  correctCount.textContent = '0'; presentCount.textContent = '0'; absentCount.textContent = '0';
  copyLastGuess.disabled = true;
  revealWord.disabled = false;
  historyActions.hidden = true;
  setMessage(gameMessage, '');
  createRow(true);
}

creatorForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!validateCustomWord()) return;
  const word = normalizeWord(customWord.value, keepSpaces.checked);
  if (!word) { setMessage(creatorMessage, 'Enter at least one letter.'); return; }
  if (word.length > MAX_WORD_LENGTH) { setMessage(creatorMessage, `Use ${MAX_WORD_LENGTH} letters or fewer.`); return; }
  const link = makeShareLink(word);
  shareLink.value = link; shareResult.hidden = false;
  setMessage(creatorMessage, 'Link ready.');
});
customWord.addEventListener('input', validateCustomWord);
document.querySelector('#copy-link').addEventListener('click', () => copyText(shareLink.value, 'Link copied.'));
document.querySelector('#new-game').addEventListener('click', () => { history.replaceState({}, '', window.location.pathname); secret = ''; game.hidden = true; gameDock.hidden = true; creator.hidden = false; customWord.focus(); });
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
boardZoom.addEventListener('input', () => {
  const percent = Number(boardZoom.value);
  zoomValue.value = `${percent}%`; zoomValue.textContent = `${percent}%`;
  board.style.setProperty('--tile-size', scaledTileSize());
});
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

const encodedWord = new URLSearchParams(window.location.search).get('word');
const decodedWord = encodedWord ? decodeWord(encodedWord) : '';
if (decodedWord) startGame(decodedWord);
else if (encodedWord) setMessage(creatorMessage, 'That link does not contain a valid custom word.');
