// SPDX-License-Identifier: GPL-3.0-only
/** A browser invitation is a web page, never a WebSocket transport address. */
export function buildFriendInvite({ pageURL, roomId, relay }) {
  const page = new URL(pageURL);
  if (!['http:', 'https:'].includes(page.protocol)) throw new Error('请从好友版网页打开房间。');
  const room = String(roomId ?? '');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(room)) throw new Error('请先创建或加入房间，再邀请好友。');
  const invite = new URL('/friends/', page.origin);
  invite.searchParams.set('room', room);
  if (relay) {
    const transport = new URL(relay);
    if (!['ws:', 'wss:'].includes(transport.protocol)) throw new Error('联机服务器地址无效。');
    if (page.protocol === 'https:' && transport.protocol !== 'wss:') throw new Error('此网页需要安全的联机服务器地址。');
    const defaultRelay = new URL('/relay', page.origin);
    defaultRelay.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
    if (transport.href !== defaultRelay.href) invite.searchParams.set('relay', transport.href);
  }
  return invite.href;
}
