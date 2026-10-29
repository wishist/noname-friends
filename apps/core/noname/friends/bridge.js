// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, _status } from 'noname';
import { readProfile } from './config.js';
import { buildFriendInvite } from './invite.js';

/** Both room sharing controls use the same visible, copyable browser invitation. */
export function shareFriendRoom() {
  if (!game.roomId || !game.onlineroom && !game.online) return alert('请先在联机大厅创建或加入一个房间。');
  let invite;
  try { invite = buildFriendInvite({ pageURL: location.href, roomId: game.roomId, relay: _status.ip }); }
  catch (error) { return alert(error.message); }
  document.getElementById('friends-invite-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'friends-invite-dialog'; overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '邀请好友加入房间');
  Object.assign(overlay.style, { position:'fixed', inset:'0', zIndex:'100010', display:'grid', placeItems:'center', background:'#080d16bb', font:'15px/1.7 Microsoft YaHei,sans-serif' });
  const box = document.createElement('div');
  Object.assign(box.style, { position:'relative', width:'min(560px,90vw)', boxSizing:'border-box', padding:'24px', borderRadius:'12px', background:'#182231', color:'#e9e4d8', border:'1px solid #a6895266' });
  const title = document.createElement('h2'); title.textContent = '邀请好友加入房间';
  Object.assign(title.style, {position:'static',margin:'0 0 12px',fontSize:'22px',color:'#e1c794'});
  const help = document.createElement('p'); help.textContent = '发送下面的网页链接。好友打开后点击“加入好友房间”，你保持房间页面开启。';
  Object.assign(help.style, {position:'static',margin:'0 0 14px'});
  const input = document.createElement('input'); input.value = invite; input.readOnly = true; input.setAttribute('aria-label', '好友网页邀请链接');
  Object.assign(input.style, {position:'static',width:'100%',boxSizing:'border-box',padding:'12px',background:'#0e1724',color:'#eef1f5',border:'1px solid #796441',borderRadius:'6px',font:'14px system-ui',userSelect:'text'});
  const message = document.createElement('p'); message.setAttribute('role','status');
  Object.assign(message.style, {position:'static',fontSize:'13px',color:'#b9c6d7',margin:'12px 0'});
  message.textContent = ['localhost','127.0.0.1','[::1]'].includes(location.hostname) ? '当前为本机地址，异地好友请使用公网好友大厅创建的房间。' : '好友无需安装或部署游戏。';
  const actions = document.createElement('div'); Object.assign(actions.style,{position:'static',display:'flex',gap:'12px',marginTop:'16px'});
  function action(label, handler) { const b=document.createElement('button'); b.textContent=label;b.onclick=handler;Object.assign(b.style,{position:'static',padding:'10px 16px',border:'1px solid #796441',borderRadius:'5px',background:'#28313e',color:'#e1c794',font:'inherit',cursor:'pointer'});actions.append(b); }
  action('复制邀请链接', async () => {
    try { await navigator.clipboard.writeText(invite); message.textContent='网页邀请链接已复制，发送给好友即可。'; }
    catch { input.focus(); input.select(); message.textContent='已选中邀请链接，请长按复制或按 Ctrl+C。'; }
  });
  action('关闭', () => overlay.remove());
  overlay.addEventListener('keydown', event => { if(event.key==='Escape') overlay.remove(); });
  box.append(title,help,input,message,actions);overlay.append(box);document.body.append(overlay);input.focus();input.select();
}

/** Small companion toolbar; all authoritative changes are still validated by the engine. */
export function installFriendsToolbar() {
  if (document.getElementById('friends-toolbar')) return;
  const bar = document.createElement('div');
  bar.id = 'friends-toolbar';
  Object.assign(bar.style, { position:'fixed', bottom:'8px', left:'50%', transform:'translateX(-50%)', display:'flex', gap:'8px', zIndex:'100000', padding:'6px', background:'#111924e8', border:'1px solid #796441', borderRadius:'8px', font:'12px Microsoft YaHei,sans-serif' });
  function button(label, fn) {const b=document.createElement('button');b.textContent=label;b.onclick=fn;Object.assign(b.style,{background:'#28313e',color:'#e3cca3',border:'1px solid #5d5746',borderRadius:'4px',padding:'7px 12px',cursor:'pointer'});bar.append(b);return b;}
  button('邀请好友', shareFriendRoom);
  button('牌堆 / 武将池',()=>{
    if (!_status.waitingForPlayer || _status.gameStarted || lib.configOL.gameStarted || game.online && !game.onlinezhu) return alert('请由房主在房间等待阶段修改牌堆和武将池。');
    const overlay=document.createElement('div');Object.assign(overlay.style,{position:'fixed',inset:'0',background:'#0c1016',zIndex:'100001',display:'flex',flexDirection:'column'});
    const top=document.createElement('div');Object.assign(top.style,{padding:'10px 20px',background:'#1b2330',display:'flex',gap:'15px',alignItems:'center',color:'#ded5bc',font:'13px Microsoft YaHei'});
    const info=document.createElement('span');info.textContent='修改完成后，将方案应用到当前房间。开始游戏后不可修改。';top.append(info);
    const apply=document.createElement('button');apply.textContent='应用到房间';Object.assign(apply.style,{marginLeft:'auto',padding:'10px 16px',background:'#d7b57a',color:'#211e17',border:'none',cursor:'pointer'});
    apply.onclick=()=>{try{
      if(!_status.waitingForPlayer || _status.gameStarted || lib.configOL.gameStarted || game.online&&!game.onlinezhu)throw Error('房间已经开始，或你不是房主');
      const profile=readProfile();if(!profile)throw Error('请先保存一个配置');
      if(game.online)game.send('changeRoomConfig',{friendsProfile:profile});
      else {game.applyFriendRoomProfile(profile);lib.configOL.friendsRevision=(lib.configOL.friendsRevision||0)+1;game.broadcastAll(function(config){Object.assign(lib.configOL,config);},lib.configOL);game.send('server','config',lib.configOL);game.updateWaiting();}
      overlay.remove();
    }catch(error){alert(error.message);}};
    const close=document.createElement('button');close.textContent='返回牌桌';Object.assign(close.style,{padding:'10px',cursor:'pointer'});close.onclick=()=>overlay.remove();top.append(apply,close);
    const frame=document.createElement('iframe');frame.src='/friends/?editor=1';frame.title='房主牌堆与武将池编辑器';Object.assign(frame.style,{flex:'1',width:'100%',border:'0'});overlay.append(top,frame);document.body.append(overlay);
  });
  button('回好友大厅',()=>{if(_status.waitingForPlayer||_status.over||!game.onlineroom){location.href='/friends/';}else if(confirm('离开会中断你当前的连接，确定返回好友大厅？'))location.href='/friends/';});
  const summary=document.createElement('span');
  Object.assign(summary.style,{color:'#b4c5bf',alignSelf:'center',fontSize:'11px',whiteSpace:'nowrap'});
  const refresh=()=>{const p=lib.configOL.friendsProfile;summary.textContent=p?`${p.enabled?Object.values(p.counts).reduce((a,b)=>a+b,0)+' 张':'默认牌堆'} · ${p.characterPacks.length} 个武将池`:'';};
  refresh();setInterval(refresh,2000);bar.append(summary);
  document.body.append(bar);
}
