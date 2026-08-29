// PreToolUse / PostToolUse の payload から、ダッシュボード表示用の情報を取り出す共通ヘルパー。
//
// - describeTool() : 「今なにをしているか」を1行で表す文字列（Bashならコマンド、Editならファイル名…）
// - classifyFeature() : スキル・スラッシュコマンド・MCP・サブエージェントの「使用中の機能」チップ

const MAX_DETAIL = 60;

function truncate(text, max) {
  if (!text) return '';
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

// 絶対パスはカードに収まらないので、プロジェクトルートからの相対パスにする
function relPath(p, cwd) {
  if (!p) return '';
  const s = String(p);
  return (cwd && s.startsWith(cwd + '/')) ? s.slice(cwd.length + 1) : s;
}

function hostOf(url) {
  try { return new URL(String(url)).host; } catch (e) { return String(url || ''); }
}

// mcp__claude_ai_Google_Calendar__list_events → 「Google Calendar」
function mcpLabel(toolName) {
  const server = String(toolName).split('__')[1] || 'mcp';
  return server.replace(/^claude_ai_/, '').replace(/_/g, ' ');
}

function describeTool(toolName, toolInput, cwd) {
  const i = toolInput || {};
  switch (toolName) {
    case 'Bash':         return truncate(i.command, MAX_DETAIL);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': return truncate(relPath(i.file_path, cwd), MAX_DETAIL);
    case 'Grep':
    case 'Glob':         return truncate(i.pattern, MAX_DETAIL);
    case 'Task':
    case 'Agent':        return truncate(i.description, MAX_DETAIL);
    case 'Skill':        return truncate(i.skill, MAX_DETAIL);
    case 'SlashCommand': return truncate(i.command, MAX_DETAIL);
    case 'WebFetch':     return truncate(hostOf(i.url), MAX_DETAIL);
    case 'WebSearch':    return truncate(i.query, MAX_DETAIL);
    case 'TodoWrite':    return '';
    default:
      // MCPツールは mcp__<server>__<tool> の <tool> 部分を出す
      if (String(toolName).startsWith('mcp__')) {
        return truncate(String(toolName).split('__')[2] || '', MAX_DETAIL);
      }
      return '';
  }
}

// 戻り値 null は「チップにしない普通のツール」
function classifyFeature(toolName, toolInput) {
  const i = toolInput || {};
  if (toolName === 'Skill') {
    return { kind: 'skill', label: truncate(i.skill, 24) || 'skill' };
  }
  if (toolName === 'SlashCommand') {
    return { kind: 'command', label: truncate(String(i.command || '').split(' ')[0], 24) || 'command' };
  }
  if (toolName === 'Task' || toolName === 'Agent') {
    return { kind: 'subagent', label: truncate(i.subagent_type, 24) || 'agent' };
  }
  if (String(toolName).startsWith('mcp__')) {
    return { kind: 'mcp', label: truncate(mcpLabel(toolName), 24) };
  }
  return null;
}

module.exports = { describeTool, classifyFeature, truncate };
