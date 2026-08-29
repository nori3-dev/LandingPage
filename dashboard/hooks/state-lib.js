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

// rate_limits(5h/週間)はアカウント単位でプロジェクトに依存しないため、towerごとではなく
// 全towerで共有する1ファイルにまとめる。書き込むのはどのプロジェクトのstatusLineでもよい。
const GLOBAL_USAGE_PATH = path.join(STATE_DIR, 'usage-global.json');
const GLOBAL_LOCK_PATH = GLOBAL_USAGE_PATH + '.lock';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// hookプロセスが途中で死ぬとロックファイルが残り、以後そのファイルは永久に書けなくなる。
// （実際に usage-global.json.lock が4日間残り、全コンテナでレート制限の記録が止まっていた）
// これより古いロックは持ち主が死んだものとみなして奪う。hookは一瞬で終わるので余裕を見て30秒。
const STALE_LOCK_MS = 30 * 1000;

function acquireLock(lockPath, retries = 100, waitMs = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          fs.unlinkSync(lockPath);
          continue; // 奪えたので待たずに取り直す
        }
      } catch (e2) {
        // statに失敗＝他プロセスが先に消した。次のループで普通に取れる
      }
      sleepSync(waitMs);
    }
  }
  throw new Error(`${lockPath} を取得できませんでした（他のhookが長時間ロック中）`);
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (e) { /* 既に無ければ無視 */ }
}

// イベントログは放っておくと際限なく伸びるので、書き込み時に末尾N件へ丸める
const MAX_EVENTS = 200;
// 並列ツール実行の同時追跡数と、直近ツール履歴・機能チップの保持数
const MAX_RUNNING_TOOLS = 10;
const MAX_RECENT_TOOLS = 10;
const MAX_FEATURES = 12;
// 指示（プロンプト）は全文を持つが、巨大な貼り付けでstate.jsonが膨らむのを防ぐ
const MAX_PROMPT_CHARS = 4000;

function defaultState() {
  return {
    tower: { id: TOWER_ID, label: TOWER_LABEL },
    updatedAt: null,
    mission: { phase: 'standby', startedAt: null, completedAt: null, summary: { agentCount: 0, totalTokens: 0, durationSec: 0 } },
    // 本体（メインセッション）自身の稼働状態。サブエージェントの有無とは独立に、
    // UserPromptSubmit〜Stopの間だけ'active'になる。
    main: {
      status: 'idle',
      startedAt: null,
      // 「どういう指示で動いているか」— UserPromptSubmitのpayload.promptを全文保持する
      prompt: null,
      promptAt: null,
      promptId: null,
      // 実行環境の情報（PreToolUse / statusLine のpayloadから拾う）
      model: null,
      permissionMode: null,
      effortLevel: null,
      // 「今なにをしているか」— tool_use_idをキーにした実行中ツール。
      // Claudeは複数ツールを並列実行するため単数では追跡できない。
      runningTools: [],
      recentTools: [],
      // 「スキル等を使っているか」— このターンで使った機能チップ（kind: skill/command/mcp/subagent）
      features: [],
      toolCount: 0,
      context: { usedPct: null, totalTokens: null, contextWindowSize: null },
    },
    // 「人間の対応が必要」な状態（応答完了 or 権限確認待ち）。次の作業開始で自動解除。
    attention: { active: false, kind: null, since: null },
    agents: [],
    events: [],
  };
}

// 旧バージョンのstate.jsonにはmain/attentionや後から足したフィールドが無いので、読み込み時に補完する
function withDefaults(state) {
  const d = defaultState();
  state.main = Object.assign({}, d.main, state.main, { context: Object.assign({}, d.main.context, state.main && state.main.context) });
  state.attention = Object.assign({}, d.attention, state.attention);
  // 配列・数値は型ごと壊れていても落ちないように整える
  ['runningTools', 'recentTools', 'features'].forEach((k) => {
    if (!Array.isArray(state.main[k])) state.main[k] = [];
  });
  if (typeof state.main.toolCount !== 'number') state.main.toolCount = 0;
  if (!Array.isArray(state.events)) state.events = [];
  if (!Array.isArray(state.agents)) state.agents = [];
  return state;
}

// 「このターンで何をしたか」の集計をリセットする（UserPromptSubmit時に呼ぶ）
function resetTurn(main) {
  main.runningTools = [];
  main.recentTools = [];
  main.features = [];
  main.toolCount = 0;
}

// 実行中ツールを1件登録する。並列実行に備えてtool_use_idをキーに持つ。
function pushRunningTool(main, entry) {
  main.runningTools = main.runningTools.filter((t) => t.toolUseId !== entry.toolUseId);
  main.runningTools.push(entry);
  if (main.runningTools.length > MAX_RUNNING_TOOLS) {
    main.runningTools = main.runningTools.slice(-MAX_RUNNING_TOOLS);
  }
}

// 実行中ツールを取り除き、直近履歴へ移す。戻り値は取り除いたエントリ（無ければnull）。
function finishRunningTool(main, toolUseId, at) {
  const idx = main.runningTools.findIndex((t) => t.toolUseId === toolUseId);
  const entry = idx >= 0 ? main.runningTools[idx] : null;
  if (idx >= 0) main.runningTools.splice(idx, 1);
  if (entry) {
    main.recentTools.push({ name: entry.name, detail: entry.detail, at, since: entry.since });
    if (main.recentTools.length > MAX_RECENT_TOOLS) {
      main.recentTools = main.recentTools.slice(-MAX_RECENT_TOOLS);
    }
  }
  return entry;
}

// 機能チップを追加する。同じものは重複させず回数を数える。
function addFeature(main, feature, at) {
  const found = main.features.find((f) => f.kind === feature.kind && f.label === feature.label);
  if (found) {
    found.count = (found.count || 1) + 1;
    found.at = at;
    return;
  }
  main.features.push({ kind: feature.kind, label: feature.label, count: 1, at });
  if (main.features.length > MAX_FEATURES) {
    main.features = main.features.slice(-MAX_FEATURES);
  }
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return defaultState();
  try {
    return withDefaults(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')));
  } catch (e) {
    return defaultState();
  }
}

function writeState(state) {
  state.tower = { id: TOWER_ID, label: TOWER_LABEL };
  state.updatedAt = new Date().toISOString();
  // サブエージェントを使わないセッションではeventsがクリアされないため、ここで丸める
  if (Array.isArray(state.events) && state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

// Claude終了時に、このコンテナのカードをダッシュボードから即座に消す。
// （放置された場合は server.js 側が10分で掃除するが、正常終了ならそれを待たせない）
function deleteState() {
  try { fs.unlinkSync(STATE_PATH); } catch (e) { /* 既に無ければ無視 */ }
  try { fs.unlinkSync(STATE_PATH + '.tmp'); } catch (e) { /* 同上 */ }
  releaseLock(LOCK_PATH);
}

function withLock(fn) {
  acquireLock(LOCK_PATH);
  try {
    const state = readState();
    fn(state);
    writeState(state);
  } finally {
    releaseLock(LOCK_PATH);
  }
}

function defaultGlobalUsage() {
  return { updatedAt: null, rateLimits: { fiveHour: null, sevenDay: null } };
}

function readGlobalUsage() {
  if (!fs.existsSync(GLOBAL_USAGE_PATH)) return defaultGlobalUsage();
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_USAGE_PATH, 'utf8'));
  } catch (e) {
    return defaultGlobalUsage();
  }
}

// statusLineフックから呼ばれる。rate_limitsが取れた項目だけ更新する(未提供プランではnullのまま)。
function writeGlobalUsage(rateLimits) {
  acquireLock(GLOBAL_LOCK_PATH);
  try {
    const data = { updatedAt: new Date().toISOString(), rateLimits };
    const tmp = GLOBAL_USAGE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, GLOBAL_USAGE_PATH);
  } finally {
    releaseLock(GLOBAL_LOCK_PATH);
  }
}

module.exports = {
  withLock, sleepSync, STATE_DIR, STATE_PATH, TOWER_ID, TOWER_LABEL,
  GLOBAL_USAGE_PATH, readGlobalUsage, writeGlobalUsage,
  resetTurn, pushRunningTool, finishRunningTool, addFeature, deleteState,
  MAX_PROMPT_CHARS,
};
