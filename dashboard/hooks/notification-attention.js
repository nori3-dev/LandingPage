#!/usr/bin/env node
// Claude Code の Notification hook（idle_prompt / permission_prompt）から呼ばれる。
// 「人間の対応が必要」なタイミングをブラウザ側に伝える。
//
// 許可待ち(permission)の場合は、直前に PreToolUse で積んだ実行中ツールに印を付ける。
// PreToolUse は許可ダイアログより先に発火するため、「何の承認を待っているか」まで表示できる。
const { withLock } = require('./state-lib');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch (e) { /* ペイロード無しでも対応待ちは立てる */ }

  const now = new Date().toISOString();

  // payloadの実フィールドは確認済み:
  //   session_id / transcript_path / cwd / prompt_id / hook_event_name /
  //   message / notification_type
  // 判別は notification_type で足りるが、将来の変更に備えて他も見る。
  const hint = [
    payload.notification_type, payload.type, payload.reason,
    payload.matcher, payload.message, payload.title,
  ].filter(Boolean).join(' ');
  const kind = /permission/i.test(hint) ? 'permission'
    : /idle/i.test(hint) ? 'idle'
    : 'waiting';

  withLock((state) => {
    state.attention = { active: true, kind, since: now };

    if (kind === 'permission') {
      // どのツールの承認待ちかを名指しする手段が無い。実測した payload の message は
      // "Claude needs your permission" だけでツール名を含まず、tool_use_id も来ない。
      // 並列実行中に「最後に積まれた1件」を選ぶと平気で誤る（実際に誤った）。
      //
      // 許可プロンプトが出ている間は実行が止まっているので、保留中のツールをまとめて
      // 許可待ちとして印を付け、1件に絞れるかどうかの判断は画面側に委ねる。
      const running = state.main.runningTools;
      const message = String(payload.message || payload.title || '');
      const named = message && running.find((t) => t.name && message.includes(t.name));
      if (named) {
        named.state = 'awaiting-permission';   // 将来messageにツール名が入った場合の精密経路
      } else {
        running.forEach((t) => { t.state = 'awaiting-permission'; });
      }
    }

    const text = kind === 'permission' ? '本体 許可待ち'
      : kind === 'idle' ? '本体 アイドル'
      : '本体 対応待ち';
    state.events.push({ time: now, speaker: '指令塔', text });
  });

  process.exit(0);
});
