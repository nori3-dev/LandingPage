#!/usr/bin/env node
// Claude Code の statusLine から呼ばれる。ターミナル下部に表示するテキストを返しつつ、
// 副作用として本体のcontext使用率をtowerのstate.jsonへ、5h/週間レート制限を
// 全tower共有のusage-global.jsonへ書き込む（ダッシュボード用）。
// 表示フォーマットは従来の ~/.claude/statusline.js（📁🤖🧠⏱️📅の絵文字付き）を踏襲する。
const path = require('path');
const { withLock, readGlobalUsage, writeGlobalUsage } = require('./state-lib');

const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};
const SEP = '\x1b[90m ⟩ \x1b[0m';

function pct(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch (e) { /* パース失敗時も最低限は表示する */ }

  const modelName = (data.model && data.model.display_name) || '';
  const dir = path.basename((data.workspace && data.workspace.current_dir) || data.cwd || '');
  const cw = data.context_window || {};
  const rl = data.rate_limits || {};
  const effortLevel = (data.effort && data.effort.level) || null;

  const usedPct = pct(cw.used_percentage);
  const totalTokens = (cw.total_input_tokens != null || cw.total_output_tokens != null)
    ? (cw.total_input_tokens || 0) + (cw.total_output_tokens || 0)
    : null;

  withLock((state) => {
    if (data.session_id) state.sessionId = data.session_id;
    state.main.context = {
      usedPct,
      totalTokens,
      contextWindowSize: cw.context_window_size != null ? cw.context_window_size : null,
    };
    // モデル名はここでしか取れないので、ダッシュボードのカード表示用に控えておく
    if (modelName) state.main.model = modelName;
  });

  // rate_limitsは提供されない場合があるので、来ている項目だけ既存値を上書きする
  const prev = readGlobalUsage().rateLimits || {};
  const fiveHour = rl.five_hour
    ? { usedPct: pct(rl.five_hour.used_percentage), resetsAt: rl.five_hour.resets_at }
    : (prev.fiveHour || null);
  const sevenDay = rl.seven_day
    ? { usedPct: pct(rl.seven_day.used_percentage), resetsAt: rl.seven_day.resets_at }
    : (prev.sevenDay || null);
  writeGlobalUsage({ fiveHour, sevenDay });

  const parts = [];
  if (dir) parts.push(`${C.cyan}📁 ${dir}${C.reset}`);
  if (modelName) parts.push(`${C.magenta}🤖 ${modelName}${C.reset}`);
  if (effortLevel) parts.push(`${C.yellow}⚙️ ${effortLevel}${C.reset}`);
  if (usedPct != null) {
    const remaining = Math.max(0, Math.round(100 - usedPct));
    const col = remaining > 50 ? C.green : remaining > 20 ? C.yellow : C.red;
    parts.push(`${col}🧠 ${remaining}%${C.reset}`);
  }
  if (fiveHour) {
    const used = Math.min(100, Math.round(fiveHour.usedPct));
    const col = used < 50 ? C.green : used < 80 ? C.yellow : C.red;
    parts.push(`${col}⏱️ 5h使用${used}%${C.reset}`);
  }
  if (sevenDay) {
    const used = Math.min(100, Math.round(sevenDay.usedPct));
    const col = used < 50 ? C.green : used < 80 ? C.yellow : C.red;
    parts.push(`${col}📅 週使用${used}%${C.reset}`);
  }

  process.stdout.write(parts.join(SEP));
  process.exit(0);
});
