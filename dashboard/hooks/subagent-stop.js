#!/usr/bin/env node
// Claude Code の SubagentStop hook から呼ばれる。標準入力にJSONペイロードが渡る。
const { withLock } = require('./state-lib');
const { resolveSubagentTranscriptPath, readFirstUserPrompt, readTranscriptStats, truncate, buildName } = require('./transcript-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(input); } catch (e) { process.exit(0); }

  const agentId = payload.agent_id;
  if (!agentId) process.exit(0);

  const now = new Date().toISOString();
  // 完了時点ならサブエージェント自身のtranscriptは書き出し済みのはずなので、
  // ここでトークン数などに加えて、起動時に取れなかった場合の名前・任務も確実に補完する。
  const subagentTranscriptPath = resolveSubagentTranscriptPath(payload.transcript_path, agentId);
  const stats = readTranscriptStats(subagentTranscriptPath);

  withLock((state) => {
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) return; // SubagentStartを取りこぼしている場合は何もしない

    if (!agent.task) {
      const rawTask = readFirstUserPrompt(subagentTranscriptPath);
      if (rawTask) {
        agent.task = truncate(rawTask, 60);
        agent.name = buildName(agent.agentType || agent.name, rawTask);
      }
    }

    const durationSec = agent.startedAt ? (new Date(now) - new Date(agent.startedAt)) / 1000 : null;
    agent.status = 'done';
    agent.progress = 100;
    if (stats.model) agent.model = stats.model;
    agent.result = {
      durationSec: durationSec != null ? Math.round(durationSec) : null,
      tokens: stats.tokens,
      toolCalls: stats.toolCalls,
      summary: payload.last_assistant_message ? truncate(payload.last_assistant_message, 50) : null,
    };

    const summaryText = agent.result.summary ? `（${agent.result.summary}）` : '';
    state.events.push({ time: now, speaker: '指令塔', text: `${agent.name} 帰還${summaryText}` });

    const stillActive = state.agents.some((a) => a.status !== 'done');
    if (!stillActive && state.mission.phase === 'running') {
      state.mission.phase = 'done';
      state.mission.completedAt = now;
      const totalTokens = state.agents.reduce((sum, a) => sum + ((a.result && a.result.tokens) || 0), 0);
      const durationSec2 = (new Date(now) - new Date(state.mission.startedAt)) / 1000;
      state.mission.summary = {
        agentCount: state.agents.length,
        totalTokens,
        durationSec: Math.round(durationSec2),
      };
    }
  });

  process.exit(0);
});
