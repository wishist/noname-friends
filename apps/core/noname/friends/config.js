// SPDX-License-Identifier: GPL-3.0-only
// Pure helpers shared by the friends lobby and the authoritative game host.
export const PROFILE_KEY = "noname_friends_profile_v1";
export const MAX_DECK_SIZE = 5000;
const ID = /^[a-zA-Z0-9_:-]+$/;
const aliases = { huosha: "fire", leisha: "thunder", icesha: "ice", cisha: "stab", kamisha: "kami" };

function identifiers(value, field) {
	if (!Array.isArray(value) || value.length > 10000 || value.some(id => typeof id !== "string" || !ID.test(id))) {
		throw new Error(`${field}格式不正确`);
	}
	return [...new Set(value)];
}

export function normalizeProfile(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1 || typeof raw.enabled !== "boolean") {
		throw new Error("好友房配置版本或格式不正确");
	}
	const cardPacks = identifiers(raw.cardPacks ?? [], "卡牌包");
	const characterPacks = identifiers(raw.characterPacks ?? [], "武将池");
	const excludedCharacters = identifiers(raw.excludedCharacters ?? [], "禁用武将");
	if (!raw.counts || typeof raw.counts !== "object" || Array.isArray(raw.counts)) throw new Error("牌堆数量格式不正确");
	const counts = {};
	let total = 0;
	for (const [key, count] of Object.entries(raw.counts)) {
		const [name, nature, extra] = key.split("|");
		if (!name || !ID.test(name) || nature === undefined || (nature && !ID.test(nature)) || extra !== undefined) throw new Error(`卡牌标识不正确：${key}`);
		if (!Number.isSafeInteger(count) || count < 0 || count > 999) throw new Error(`卡牌数量必须是 0–999 的整数：${key}`);
		counts[key] = count;
		total += count;
	}
	if (total > MAX_DECK_SIZE) throw new Error(`牌堆不能超过 ${MAX_DECK_SIZE} 张`);
	if (!cardPacks.length || !characterPacks.length || (raw.enabled && total === 0)) throw new Error("请至少选择一个卡牌包、一个武将池，并设置非空牌堆");
	return { version: 1, enabled: raw.enabled, cardPacks, characterPacks, counts, excludedCharacters };
}

export function readProfile(storage = globalThis.localStorage) {
	const text = storage?.getItem(PROFILE_KEY);
	if (!text) return null;
	return normalizeProfile(JSON.parse(text));
}

export function normalizeCard(tuple) {
	const result = tuple.slice();
	if (aliases[result[2]]) {
		result[3] = aliases[result[2]];
		result[2] = "sha";
	}
	return result;
}

export function cardKey(tuple) {
	const card = normalizeCard(tuple);
	return `${card[2]}|${card[3] || ""}`;
}

/** Exact composition, preserving source suits/ranks/tags and never mutating source packs. */
export function buildFriendDeck(raw, packLists, definitions, mode, packCards = {}) {
	const profile = normalizeProfile(raw);
	if (!profile.enabled) return null;
	const samples = new Map();
	const allowed = new Set();
	for (const pack of profile.cardPacks) {
		if (!Object.hasOwn(packLists, pack) && !Object.hasOwn(packCards, pack)) throw new Error(`当前版本没有卡牌包：${pack}`);
		for (const id of packCards[pack] || []) allowed.add(id);
		const source = typeof packLists[pack] === "function" ? packLists[pack]() : packLists[pack] || [];
		for (const tuple of source) {
			const card = normalizeCard(tuple);
			const key = cardKey(card);
			allowed.add(card[2]);
			if (!samples.has(key)) samples.set(key, []);
			samples.get(key).push(card);
		}
	}
	const result = [];
	for (const [key, count] of Object.entries(profile.counts)) {
		if (!count) continue;
		const [name, nature] = key.split("|");
		const definition = Object.hasOwn(definitions, name) ? definitions[name] : null;
		if (!allowed.has(name) || !definition || definition.hidden) throw new Error(`所选卡牌包没有可用卡牌：${key}`);
		if ((definition.mode && !definition.mode.includes(mode)) || definition.forbid?.includes(mode)) throw new Error(`当前模式不支持卡牌：${key}`);
		const choices = samples.get(key);
		if (nature && !choices?.length) throw new Error(`所选卡牌包没有该属性版本：${key}`);
		for (let n = 0; n < count; n++) {
			const card = choices?.length ? choices[n % choices.length].slice() : [["spade", "heart", "club", "diamond"][n % 4], (n % 13) + 1, name];
			// Clone tag arrays too; shuffling and engine metadata must not mutate templates.
			for (let i = 3; i < card.length; i++) if (Array.isArray(card[i])) card[i] = [...card[i]];
			result.push(card);
		}
	}
	if (!result.length) throw new Error("牌堆中没有可用卡牌");
	return result;
}

export function applyFriendPreferences(lib, raw) {
	if (!raw) return false;
	const profile = normalizeProfile(raw);
	for (const pack of profile.cardPacks) if (!lib.connectCardPack.includes(pack)) throw new Error(`卡牌包不支持联机：${pack}`);
	for (const pack of profile.characterPacks) if (!lib.connectCharacterPack.includes(pack)) throw new Error(`武将池不支持联机：${pack}`);
	lib.config.connect_cards = lib.connectCardPack.filter(pack => !profile.cardPacks.includes(pack));
	lib.config.connect_characters = lib.connectCharacterPack.filter(pack => !profile.characterPacks.includes(pack));
	return true;
}

/** Validate all input before changing authoritative state. Clients never call this. */
export function applyFriendProfile(lib, raw, target = lib.configOL) {
	const profile = normalizeProfile(raw);
	for (const pack of profile.cardPacks) if (!lib.connectCardPack.includes(pack)) throw new Error(`卡牌包不支持联机：${pack}`);
	for (const pack of profile.characterPacks) if (!lib.connectCharacterPack.includes(pack)) throw new Error(`武将池不支持联机：${pack}`);
	const characters = new Set(profile.characterPacks.flatMap(pack => Object.keys(lib.characterPack[pack] || {})));
	for (const id of profile.excludedCharacters) characters.delete(id);
	for (const id of lib.connectBanned || []) characters.delete(id);
	if (!characters.size) throw new Error("选择的武将池中没有可用武将");
	const deck = profile.enabled ? buildFriendDeck(profile, lib.cardPackList, lib.card, target.mode, lib.cardPack) : profile.cardPacks.flatMap(pack => {
		const list = typeof lib.cardPackList[pack] === "function" ? lib.cardPackList[pack]() : lib.cardPackList[pack] || [];
		return list.map(normalizeCard).filter(card => {
			const definition = lib.card[card[2]];
			return definition && (!definition.mode || definition.mode.includes(target.mode)) && !definition.forbid?.includes(target.mode);
		});
	});
	const baseBanned = target.friendsBaseBanned || target.banned || [];
	const baseCards = target.friendsBaseBannedCards || target.bannedcards || [];
	Object.assign(target, {
		cardPack: [...profile.cardPacks], characterPack: [...profile.characterPacks],
		banned: [...new Set([...baseBanned, ...profile.excludedCharacters])],
		// Exact custom deck supersedes the old UI card bans; zero count excludes a card.
		bannedcards: profile.enabled ? [] : [...baseCards], friendsBaseBanned: [...baseBanned], friendsBaseBannedCards: [...baseCards],
		friendsProfile: profile,
	});
	lib.card.list = deck;
	return profile.enabled;
}
