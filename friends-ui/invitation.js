const validRoom = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

export function parseFriendInvitation(value, origin) {
  const input = value.trim();
  if (!input) throw new Error('请输入邀请链接或房间号');
  if (validRoom(input)) return { room: input, relay: undefined, external: false };
  let url;
  try { url = new URL(input); } catch { throw new Error('请输入完整的网页邀请链接或房间号'); }
  if (['ws:', 'wss:'].includes(url.protocol)) throw new Error('这是内部联机地址，请让房主点击“分享房间”复制 HTTPS 网页邀请链接。');
  if (!['http:', 'https:'].includes(url.protocol) || !validRoom(url.searchParams.get('room'))) throw new Error('请输入包含有效 room 房间号的网页邀请链接');
  const relay = url.searchParams.get('relay') || '';
  if (relay) {
    let transport;
    try { transport = new URL(relay); } catch { throw new Error('邀请链接中的服务器地址无效'); }
    if (!['ws:', 'wss:'].includes(transport.protocol) || url.protocol === 'https:' && transport.protocol !== 'wss:') throw new Error('邀请链接中的服务器协议无效');
  }
  url.pathname = '/friends/';
  return { room: url.searchParams.get('room'), relay, external: url.origin !== origin, href: url.href };
}
