#!/usr/bin/env node
// Claude Code の PreToolUse hook から呼ばれる（ツール実行の直前）。
//
// 役割は2つ。
// 1. 「今なにをしているか」を記録する（ツール名＋対象、スキル/MCP/サブエージェント等の機能チップ）
// 2. 権限確認(permission_prompt)などで立った attention を解除する。
//    ツールが動き出した時点で表示を実態（稼働中）に合わせる。
const { withLock, pushRunningTool, addFeature } = require('./state-lib');
const { describeTool, classifyFeature } = require('./tool-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch (e) { /* パース不能でもattention解除だけは行う */ }

  const now = new Date().toISOString();
  // payloadの実フィールドは確認済み:
  //   session_id / transcript_path / cwd / prompt_id / permission_mode /
  //   effort{level} / hook_event_name / tool_name / tool_input / tool_use_id
  const toolName = payload.tool_name || '';
  const toolUseId = payload.tool_use_id || null;
  const detail = describeTool(toolName, payload.tool_input, payload.cwd);
  const feature = classifyFeature(toolName, payload.tool_input);

  withLock((state) => {
    if (payload.session_id) state.sessionId = payload.session_id;
    if (state.attention && state.attention.active) {
      state.attention = { active: false, kind: null, since: null };
    }
    if (!toolName) return;

    // サブエージェントのツール実行なら、本体の「今」を上書きせずそのエージェント側に記録する
    const agent = payload.agent_id ? state.agents.find((a) => a.id === payload.agent_id) : null;
    if (agent) {
      agent.currentTool = { name: toolName, detail, since: now, toolUseId, state: 'running' };
      return;
    }

    pushRunningTool(state.main, { name: toolName, detail, since: now, toolUseId, state: 'running' });
    state.main.toolCount = (state.main.toolCount || 0) + 1;
    if (feature) addFeature(state.main, feature, now);
    if (payload.permission_mode) state.main.permissionMode = payload.permission_mode;
    if (payload.effort && payload.effort.level) state.main.effortLevel = payload.effort.level;
  });

  process.exit(0);
});
