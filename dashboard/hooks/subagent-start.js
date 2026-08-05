#!/usr/bin/env node
// Claude Code の SubagentStart hook から呼ばれる。標準入力にJSONペイロードが渡る。
const { withLock, sleepSync } = require('./state-lib');
const { resolveSubagentTranscriptPath, readFirstUserPrompt, truncate, buildName } = require('./transcript-lib');

// 起動直後はサブエージェント自身のtranscriptがまだ書かれていないことが多い。
// 待ちすぎるとサブエージェントの起動自体を遅らせてしまうので、ごく短時間だけベストエフォートで試す。
// 見つからなければ空のまま進み、SubagentStop側で確実に補完する。
function readFirstUserPromptQuick(transcriptPath, retries = 3, waitMs = 50) {
  for (let i = 0; i < retries; i++) {
    const text = readFirstUserPrompt(transcriptPath);
    if (text) return text;
    sleepSync(waitMs);
  }
  return '';
}

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(input); } catch (e) { process.exit(0); }

  const agentId = payload.agent_id;
  if (!agentId) process.exit(0);

  const agentType = payload.agent_name || payload.agent_type || 'agent';
  const subagentTranscriptPath = resolveSubagentTranscriptPath(payload.transcript_path, agentId);
  const rawTask = readFirstUserPromptQuick(subagentTranscriptPath);
  const task = truncate(rawTask, 60);
  const name = buildName(agentType, rawTask);
  const now = new Date().toISOString();

  withLock((state) => {
    // 前回のミッションが完了済みなら、新規ミッションとしてクリアする
    if (state.mission.phase === 'done') {
      state.agents = [];
      state.events = [];
      state.mission = { phase: 'running', startedAt: now, completedAt: null, summary: { agentCount: 0, totalTokens: 0, durationSec: 0 } };
    } else if (state.mission.phase === 'standby') {
      state.mission.phase = 'running';
      state.mission.startedAt = now;
    }

    let agent = state.agents.find((a) => a.id === agentId);
    if (!agent) {
      agent = { id: agentId, generation: 1, parentId: 'root' };
      state.agents.push(agent);
    }
    agent.name = name;
    agent.agentType = agentType;
    agent.model = agent.model || null;
    agent.task = task;
    agent.status = 'running';
    agent.startedAt = now;
    agent.progress = 0;
    agent.result = { durationSec: null, tokens: null, toolCalls: null, summary: null };

    state.events.push({ time: now, speaker: '指令塔', text: `${name} 誕生` });
  });

  process.exit(0);
});
