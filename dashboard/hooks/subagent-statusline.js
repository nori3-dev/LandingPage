#!/usr/bin/env node
// Claude Code の subagentStatusLine から呼ばれる。エージェントパネルの見た目は変更せず
// （id無しの行は出力しない＝デフォルト表示を維持）、副作用として各サブエージェントの
// context使用率をstate.jsonへ書き込む。
const { withLock } = require('./state-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch (e) { process.exit(0); }

  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (tasks.length === 0) process.exit(0);

  withLock((state) => {
    tasks.forEach((t) => {
      const agent = state.agents.find((a) => a.id === t.id);
      if (!agent) return; // SubagentStartをまだ拾っていない場合は何もしない

      const windowSize = t.contextWindowSize != null ? t.contextWindowSize : null;
      const tokenCount = t.tokenCount != null ? t.tokenCount : null;
      const usedPct = (windowSize && tokenCount != null)
        ? Math.round((tokenCount / windowSize) * 1000) / 10
        : null;

      agent.context = { usedPct, tokenCount, contextWindowSize: windowSize };
    });
  });

  process.exit(0); // 標準出力に何も書かない＝各行はデフォルト表示のまま
});
