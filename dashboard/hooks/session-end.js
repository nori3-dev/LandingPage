#!/usr/bin/env node
// Claude Code の SessionEnd hook から呼ばれる（セッション終了）。
// このコンテナのカードをダッシュボードから即座に消す。
//
// 状態ファイルは「コンテナ単位」（state-<hostname>.json）なので、
// 消してよいのは自分がその持ち主である場合だけ。同じコンテナで別セッションが
// 動いている場合に消すと、生きているほうのカードまで巻き添えで消える。
const { withLock, resetTurn, deleteState } = require('./state-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch (e) { /* パース不能なら何もしない */ }

  const reason = payload.reason || 'other';
  const sessionId = payload.session_id || null;

  // /clear はセッションが作り直されるだけでコンテナは生きている。消さずに中身だけ畳む。
  if (reason === 'clear') {
    withLock((state) => {
      state.main.status = 'idle';
      state.main.prompt = null;
      state.main.promptAt = null;
      resetTurn(state.main);
      state.attention = { active: false, kind: null, since: null };
      state.events.push({ time: new Date().toISOString(), speaker: '指令塔', text: 'セッションをクリア' });
    });
    process.exit(0);
  }

  let owner = true;
  withLock((state) => {
    // 記録されている持ち主が自分でなければ、別セッションが生きているとみなして消さない
    if (state.sessionId && sessionId && state.sessionId !== sessionId) owner = false;
  });

  if (owner) deleteState();

  process.exit(0);
});
