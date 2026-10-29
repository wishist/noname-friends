import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFriendInvite } from '../apps/core/noname/friends/invite.js';
import { parseFriendInvitation } from '../friends-ui/invitation.js';

test('public invitation is an HTTPS page with the exact room, not a WebSocket URL', () => {
  const invite = buildFriendInvite({ pageURL:'https://game.example/?friends=1', roomId:'123456789012345', relay:'wss://game.example/relay' });
  assert.equal(invite, 'https://game.example/friends/?room=123456789012345');
  assert.equal(new URL(invite).protocol,'https:');
  assert.equal(new URL(invite).searchParams.get('room'),'123456789012345');
});
test('generated invitations round trip through the guest form and override stale relay preferences', () => {
  const url = buildFriendInvite({pageURL:'https://game.example/?friends=1',roomId:'86403702731',relay:'wss://game.example/relay'});
  const parsed = parseFriendInvitation(url,'https://game.example');
  assert.equal(parsed.room,'86403702731');
  assert.equal(parsed.relay,'');
  assert.equal(parsed.external,false);
  assert.equal(parseFriendInvitation('room-42','https://game.example').relay,undefined);
  assert.equal(parseFriendInvitation('https://other.example/?friends=1&room=12345&relay=wss%3A%2F%2Fhall.example%2Frelay','https://game.example').relay,'wss://hall.example/relay');
  assert.equal(parseFriendInvitation(url,'https://other.example').external,true);
});
test('guest form explains raw transport URLs and rejects invalid invitation schemes and room IDs', () => {
  assert.throws(()=>parseFriendInvitation('wss://game.example/relay','https://game.example'),/内部联机地址/);
  for (const value of ['','javascript:alert(1)','https://game.example/','https://game.example/?room=bad%2Froom','https://game.example/?room=12345&relay=ws://hall.example']) {
    assert.throws(()=>parseFriendInvitation(value,'https://game.example'));
  }
});
test('external relay remains encoded inside a web invitation', () => {
  const invite = new URL(buildFriendInvite({ pageURL:'https://game.example/friends/', roomId:'room-42', relay:'wss://hall.example/socket' }));
  assert.equal(invite.origin, 'https://game.example');
  assert.equal(invite.searchParams.get('relay'),'wss://hall.example/socket');
  assert.equal(invite.searchParams.get('room'),'room-42');
});
test('local development is an HTTP page and invalid room or transport is rejected', () => {
  assert.equal(buildFriendInvite({pageURL:'http://localhost:8090/',roomId:'12345',relay:'ws://localhost:8090/relay'}),'http://localhost:8090/friends/?room=12345');
  for (const roomId of [undefined,'','../bad','a?x=1']) assert.throws(()=>buildFriendInvite({pageURL:'https://game.example',roomId}));
  assert.throws(()=>buildFriendInvite({pageURL:'wss://game.example/relay',roomId:'12345'}));
  assert.throws(()=>buildFriendInvite({pageURL:'https://game.example',roomId:'12345',relay:'ws://game.example/relay'}));
});
