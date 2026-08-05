// state.json への排他書き込みを行う共通ヘルパー（Claude Codeのhookスクリプトから呼ばれる）
//
// 複数のDocker環境（コンテナ）から同時に使われることを想定し、状態ファイルは
// 各コンテナで共有されている `~/.claude`（Windows側の .claude-global を bind mount した場所）配下、
// コンテナごとに個別のファイル（state-<hostname>.json）に書く。
// これにより1つのダッシュボードサーバーが複数の「指令塔」を横に並べて表示できる。
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'subagentview');
fs.mkdirSync(STATE_DIR, { recursive: true });

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

const TOWER_ID = sanitize(os.hostname());
const TOWER_LABEL = path.basename(process.env.CLAUDE_PROJECT_DIR || process.cwd());

const STATE_PATH = path.join(STATE_DIR, `state-${TOWER_ID}.json`);
const LOCK_PATH = STATE_PATH + '.lock';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(retries = 100, waitMs = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.closeSync(fs.openSync(LOCK_PATH, 'wx'));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      sleepSync(waitMs);
    }
  }
  throw new Error('state.json.lock を取得できませんでした（他のhookが長時間ロック中）');
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch (e) { /* 既に無ければ無視 */ }
}

function defaultState() {
  return {
    tower: { id: TOWER_ID, label: TOWER_LABEL },
    updatedAt: null,
    mission: { phase: 'standby', startedAt: null, completedAt: null, summary: { agentCount: 0, totalTokens: 0, durationSec: 0 } },
    agents: [],
    events: [],
  };
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return defaultState();
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    return defaultState();
  }
}

function writeState(state) {
  state.tower = { id: TOWER_ID, label: TOWER_LABEL };
  state.updatedAt = new Date().toISOString();
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

function withLock(fn) {
  acquireLock();
  try {
    const state = readState();
    fn(state);
    writeState(state);
  } finally {
    releaseLock();
  }
}

module.exports = { withLock, sleepSync, STATE_DIR, STATE_PATH, TOWER_ID, TOWER_LABEL };
