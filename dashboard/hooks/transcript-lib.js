// サブエージェント自身のtranscript（プロンプト・トークン数など）を読み取る共通ヘルパー
const fs = require('fs');
const path = require('path');

// hookのpayload.transcript_pathはメインセッション全体のtranscriptを指しているため、
// サブエージェント専用のtranscript（<セッションディレクトリ>/subagents/agent-<agent_id>.jsonl）
// のパスを同じ規則で組み立てる。
function resolveSubagentTranscriptPath(mainTranscriptPath, agentId) {
  if (!mainTranscriptPath) return null;
  const sessionDir = mainTranscriptPath.replace(/\.jsonl$/, '');
  return path.join(sessionDir, 'subagents', `agent-${agentId}.jsonl`);
}

function truncate(text, max) {
  if (!text) return '';
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

// transcriptの1行目（最初のuserメッセージ＝サブエージェントに与えたプロンプト）を読む。
function readFirstUserPrompt(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const firstLine = raw.split('\n').find(Boolean);
    if (!firstLine) return '';
    const obj = JSON.parse(firstLine);
    const msg = obj.message;
    if (msg && msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        const textBlock = msg.content.find((b) => b && b.type === 'text');
        if (textBlock) return textBlock.text;
      }
    }
  } catch (e) {
    // ファイル未作成/読み取り不可なら諦めて空文字を返す
  }
  return '';
}

function readTranscriptStats(transcriptPath) {
  const stats = { tokens: null, toolCalls: null, model: null };
  if (!transcriptPath) return stats;
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  } catch (e) {
    return stats;
  }
  let tokens = 0;
  let toolCalls = 0;
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    const msg = obj.message;
    if (!msg) continue;
    if (msg.model) stats.model = msg.model;
    if (msg.usage) {
      const u = msg.usage;
      tokens += (u.input_tokens || 0) + (u.output_tokens || 0) +
        (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && block.type === 'tool_use') toolCalls++;
      }
    }
  }
  stats.tokens = tokens || null;
  stats.toolCalls = toolCalls || null;
  return stats;
}

function buildName(agentType, rawTask) {
  return rawTask ? `${agentType}: ${truncate(rawTask, 18)}` : agentType;
}

module.exports = { resolveSubagentTranscriptPath, readFirstUserPrompt, readTranscriptStats, truncate, buildName };
