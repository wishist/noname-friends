import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProfile, readProfile, buildFriendDeck, applyFriendPreferences, applyFriendProfile, cardKey } from "../apps/core/noname/friends/config.js";

const profile = (extra = {}) => ({version:1, enabled:true, cardPacks:["standard","yingbian"], characterPacks:["standard","refresh"], counts:{"sha|":5,"sha|fire":3,"shan|":0}, excludedCharacters:[], ...extra});
const templates = {standard:[["spade",7,"sha"],["heart",3,"sha"],["diamond",9,"shan"]], yingbian:[["club",4,"huosha",null,["yingbian_zhuzhan"]]]};
const defs = {sha:{type:"basic"}, shan:{type:"basic"}, extra:{type:"trick"}, gz:{type:"trick",mode:["guozhan"]}};
function library() {
	return {config:{},configOL:{mode:"identity",banned:["blocked"],bannedcards:["sha"]}, connectCardPack:["standard","yingbian","other"],connectCharacterPack:["standard","refresh","other"],cardPackList:structuredClone(templates),card:{...defs,list:[]},cardPack:{standard:["sha","shan","extra","gz"],yingbian:["sha"]},characterPack:{standard:{caocao:{},liubei:{}},refresh:{re_caocao:{}}},connectBanned:[]};
}
test("exact quantities combine packs and retain attributes/tags without mutating templates", () => {
	const before = structuredClone(templates);
	const deck = buildFriendDeck(profile(), templates, defs, "identity");
	assert.equal(deck.length,8);
	assert.equal(deck.filter(c=>cardKey(c)==="sha|fire").length,3);
	assert.equal(deck.filter(c=>c[2]==="shan").length,0);
	assert.deepEqual(deck.slice(0,3).map(c=>c.slice(0,2)),[["spade",7],["heart",3],["spade",7]]);
	assert.deepEqual(deck[5].slice(2),["sha","fire",["yingbian_zhuzhan"]]);
	deck[5][4].push("changed");
	assert.deepEqual(templates,before);
});
test("valid defined cards outside default physical lists get complete suit/rank tuples", () => {
	const deck = buildFriendDeck(profile({counts:{"extra|":5}}),templates,defs,"identity",{standard:["extra"]});
	assert.equal(deck.length,5);
	assert.deepEqual(deck[0],["spade",1,"extra"]);
	assert.equal(deck[4][1],5);
});
test("rejects malformed counts, unavailable cards, unsupported natures and mode-only cards", () => {
	for (const value of [-1,1.5,1000,"2",NaN,Infinity]) assert.throws(()=>normalizeProfile(profile({counts:{"sha|":value}})));
	assert.throws(()=>normalizeProfile(profile({counts:{}})));
	assert.throws(()=>normalizeProfile(profile({counts:Object.fromEntries(Array.from({length:6},(_,n)=>[`card${n}|`,999]))})));
	assert.throws(()=>buildFriendDeck(profile({counts:{"unknown|":2}}),templates,defs,"identity"));
	assert.throws(()=>buildFriendDeck(profile({counts:{"sha|ice":2}}),templates,defs,"identity"));
	assert.throws(()=>buildFriendDeck(profile({counts:{"gz|":2}}),templates,defs,"identity",{standard:["gz"]}));
});
test("multiple character pools and exclusions are authoritative; defaults restored when custom deck disabled", () => {
	const lib = library();
	applyFriendPreferences(lib,profile());
	assert.deepEqual(lib.config.connect_characters,["other"]);
	assert.deepEqual(lib.config.connect_cards,["other"]);
	applyFriendProfile(lib,profile({excludedCharacters:["caocao"]}));
	assert.deepEqual(lib.configOL.characterPack,["standard","refresh"]);
	assert.deepEqual(lib.configOL.banned,["blocked","caocao"]);
	assert.deepEqual(lib.configOL.bannedcards,[]);
	assert.equal(lib.card.list.length,8);
	applyFriendProfile(lib,profile({excludedCharacters:["liubei"]}));
	assert.deepEqual(lib.configOL.banned,["blocked","liubei"]);
	applyFriendProfile(lib,profile({enabled:false}));
	assert.equal(lib.card.list.length,4);
	assert.deepEqual(lib.configOL.banned,["blocked"]);
	assert.deepEqual(lib.configOL.bannedcards,["sha"]);
});
test("invalid imported profile cannot partially mutate room state", () => {
	const lib=library();
	const before=structuredClone(lib);
	assert.throws(()=>applyFriendProfile(lib,profile({cardPacks:["missing"]})));
	assert.deepEqual(lib,before);
	assert.throws(()=>applyFriendProfile(lib,profile({counts:{"gz|":10}})));
	assert.deepEqual(lib,before);
	assert.throws(()=>applyFriendProfile(lib,profile({excludedCharacters:["caocao","liubei","re_caocao"]})));
	assert.deepEqual(lib,before);
});
test("storage reader validates untrusted JSON and absence means no override", () => {
	assert.equal(readProfile({getItem:()=>null}),null);
	assert.throws(()=>readProfile({getItem:()=>"not json"}));
	assert.throws(()=>readProfile({getItem:()=>JSON.stringify({...profile(),version:2})}));
	assert.deepEqual(readProfile({getItem:()=>JSON.stringify(profile())}),profile());
});
