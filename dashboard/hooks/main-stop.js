#!/usr/bin/env node
// Claude Code の Stop hook から呼ばれる（本体＝メインセッション自身の応答完了）。
// ブラウザダッシュボードに「人間の対応が必要（＝次の指示待ち）」を伝えるために attention を立てる。
// 通知はダッシュボード側（点滅・チャイム・OS通知）に一本化しているため、ここでは外部通知は行わない。
const { withLock } = require('./state-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const now = new Date().toISOString();

  withLock((state) => {
    state.main.status = 'idle';
    state.attention = { active: true, kind: 'done', since: now };
    // 応答が終わった以上、実行中ツールは残っていない（PostToolUseを取りこぼした分の掃除も兼ねる）
    state.main.runningTools = [];

    state.events.push({ time: now, speaker: '指令塔', text: '本体 応答完了' });
  });

  process.exit(0);
});
