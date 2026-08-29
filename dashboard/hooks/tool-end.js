#!/usr/bin/env node
// Claude Code の PostToolUse hook から呼ばれる（ツール実行の直後）。
// これが無いと「今なにをしているか」の表示が終わったまま固まるため、
// PreToolUse で積んだ実行中ツールを tool_use_id で突き合わせて取り除く。
const { withLock, finishRunningTool } = require('./state-lib');
const { describeTool } = require('./tool-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch (e) { process.exit(0); }

  const now = new Date().toISOString();
  const toolUseId = payload.tool_use_id || null;
  const toolName = payload.tool_name || '';

  withLock((state) => {
    // サブエージェント側の実行中表示を消す
    const agent = payload.agent_id ? state.agents.find((a) => a.id === payload.agent_id) : null;
    if (agent) {
      if (!agent.currentTool || !toolUseId || agent.currentTool.toolUseId === toolUseId) {
        agent.currentTool = null;
      }
      return;
    }

    const removed = finishRunningTool(state.main, toolUseId, now);

    // tool_use_id が来ない場合に備えたフォールバック（同名の実行中ツールを最古の1件だけ消す）
    if (!removed && toolName) {
      const match = state.main.runningTools.find((t) => t.name === toolName);
      if (match) {
        if (!match.detail) match.detail = describeTool(toolName, payload.tool_input, payload.cwd);
        finishRunningTool(state.main, match.toolUseId, now);
      }
    }
  });

  process.exit(0);
});
