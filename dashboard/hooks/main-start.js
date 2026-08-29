#!/usr/bin/env node
// Claude Code の UserPromptSubmit hook から呼ばれる（本体＝メインセッション自身の作業開始）。
// payload.prompt に「どういう指示で動いているか」が入るので、これを state に保存する。
const { withLock, resetTurn, MAX_PROMPT_CHARS } = require('./state-lib');
const { truncate } = require('./tool-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch (e) { /* ペイロード無しでも作業開始は記録する */ }

  // payloadの実フィールドは確認済み:
  //   hook_event_name / prompt / prompt_id / permission_mode / effort{level} / cwd
  const now = new Date().toISOString();
  const prompt = payload.prompt ? String(payload.prompt).slice(0, MAX_PROMPT_CHARS) : null;

  withLock((state) => {
    // SessionEnd で「消してよい持ち主か」を判定するために記録する
    if (payload.session_id) state.sessionId = payload.session_id;
    state.main.status = 'active';
    state.main.startedAt = now;
    state.main.prompt = prompt;
    state.main.promptAt = now;
    state.main.promptId = payload.prompt_id || null;
    if (payload.permission_mode) state.main.permissionMode = payload.permission_mode;
    if (payload.effort && payload.effort.level) state.main.effortLevel = payload.effort.level;

    // このターンの「何をしたか」を数え直す
    resetTurn(state.main);

    // 応答待ち/完了の「要対応」表示は、次の作業が始まった時点で自動的に解除する
    state.attention = { active: false, kind: null, since: null };

    const excerpt = truncate(prompt, 40);
    state.events.push({ time: now, speaker: '指令塔', text: excerpt ? `本体 作業開始: ${excerpt}` : '本体 作業開始' });
  });

  process.exit(0);
});
