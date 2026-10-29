import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFriendProfile } from "../apps/core/noname/friends/config.js";

// Run the actual incoming network handlers with a controlled host runtime.
const source = readFileSync(new URL("../apps/core/noname/library/index.js", import.meta.url), "utf8");
function harness(name, waiting = true) {
	const begin = source.indexOf(`\t\t\t${name}(`);
	assert.ok(begin > 0);
	const end = source.indexOf("\n\t\t\t},", begin) + "\n\t\t\t}".length;
	const lib = {mode:{identity:{connect:{connect_player_number:{}, update(){}}}},configOL:{mode:"identity",number:2,banned:[],bannedcards:[],cardPack:["standard"],characterPack:["standard"]},connectCardPack:["standard"],connectCharacterPack:["standard"],connectBanned:[],characterPack:{standard:{caocao:{},liubei:{}}},cardPack:{standard:["sha"]},cardPackList:{standard:[["spade",7,"sha"]]},card:{sha:{},list:[]}};
	const state = {waitingForPlayer:waiting};
	let broadcasts = 0, resumed = 0;
	const game = {onlinezhu:"host",connectPlayers:[],broadcastAll(fn,value){broadcasts++;fn(value);},applyFriendRoomProfile(profile,target){return applyFriendProfile(lib,profile,target);},validateFriendRoomStart(){return true;},resume(){resumed++;}};
	const fn = new Function("lib", "game", "_status", "ui", `return ({${source.slice(begin,end)}}).${name}`)(lib,game,state,{});
	return {lib,game,state,fn,broadcasts:()=>broadcasts,resumed:()=>resumed};
}
const profile = {version:1,enabled:true,cardPacks:["standard"],characterPacks:["standard"],excludedCharacters:[],counts:{"sha|":20}};
test("actual room update handler refuses a guest and refuses updates after game start", () => {
	for (const [id,waiting,started] of [["guest",true,false],["host",false,false],["host",true,true]]) {
		const h=harness("changeRoomConfig",waiting);h.lib.configOL.gameStarted=started;
		h.fn.call({id,send(){throw new Error("must not send");}}, {friendsProfile:profile});
		assert.equal(h.broadcasts(),0);assert.equal(h.lib.card.list.length,0);
	}
});
test("host updates use the validated exact composition and cannot replace protected room state", () => {
	const h=harness("changeRoomConfig");
	h.fn.call({id:"host",send(){}}, {friendsProfile:profile,mode:"guozhan",gameStarted:true,player_number:"4"});
	assert.equal(h.broadcasts(),1);assert.equal(h.lib.card.list.length,20);
	assert.equal(h.lib.configOL.mode,"identity");assert.notEqual(h.lib.configOL.gameStarted,true);
	assert.equal(h.lib.configOL.player_number,"4");
});
test("malformed imported counts leave host state unchanged and notify only the requesting owner", () => {
	const h=harness("changeRoomConfig");let notices=0;
	h.fn.call({id:"host",send(){notices++;}}, {friendsProfile:{...profile,counts:{"sha|":-1}}});
	assert.equal(notices,1);assert.equal(h.broadcasts(),0);assert.equal(h.lib.card.list.length,0);
});
test("actual start handler is restricted to the owner of a waiting, valid room", () => {
	const h=harness("startGame");
	h.fn.call({id:"guest"});assert.equal(h.resumed(),0);
	h.game.validateFriendRoomStart=()=>false;h.fn.call({id:"host"});assert.equal(h.resumed(),0);
	h.game.validateFriendRoomStart=()=>true;h.fn.call({id:"host"});assert.equal(h.resumed(),1);
	h.state.waitingForPlayer=false;h.fn.call({id:"host"});assert.equal(h.resumed(),1);
});
