import { lib, game, ui, get, ai, _status } from "noname";
import characters from "./character.js";
import cards from "./card.js";
import pinyins from "./pinyin.js";
import skills from "./skill.js";
import translates from "./translate.js";
import voices from "./voices.js";
import { characterSort, characterSortTranslate } from "./sort.js";

game.import("character", function () {
	if (lib.config.characters.includes("key")) {
		lib.group.add("key");
	}
	return {
		name: "key",
		connect: true,
		character: { ...characters },
		characterSort: {
			key: characterSort,
		},
		characterFilter: {
			key_jojiro(mode) {
				return mode == "chess" || mode == "tafang";
			},
			key_yuu(mode) {
				return mode == "identity" || mode == "doudizhu" || mode == "single" || (mode == "versus" && _status.mode != "standard" && _status.mode != "three");
			},
			key_tomoya(mode) {
				return mode != "chess" && mode != "tafang" && mode != "stone";
			},
			key_sunohara(mode) {
				return mode != "guozhan";
			},
		},
		characterTitle: {
			key_kotomi: "#g落英逐紫裙",
			key_jojiro: "战棋专属角色",
			key_kud: "#b千夜",
			key_misuzu: "#b长发及腰黑长直",
			key_kamome: "#b仿生纱",
			key_nao: "#b潮鸣",
			key_kyou: "#b长发及腰黑长直",
			key_yuuki: "#b4399司命",
			key_kyouko: "#b阿阿阿687",
			key_tenzen: "#b皋耳击",
			key_kotarou: "#bb1154486224",
			key_seira: "#b阿开木木W🍀",
			key_kiyu: "#b无面◎隐者",
			key_tomoyo: "#b长发及腰黑长直",
			key_minagi: "#b无面◎隐者",
		},
		card: { ...cards },
		skill: { ...skills },
		translate: { ...translates, ...voices, ...characterSortTranslate },
		pinyins: { ...pinyins },
	};
});
