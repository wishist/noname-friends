/** Build the lobby catalog from the checked-out GPL-3.0 upstream sources.
 * Usage: node --experimental-vm-modules friends-tools/generate-catalog.mjs
 * No browser or game event/skill is run: only module definitions are evaluated.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const core = path.join(root, 'apps/core');
const context = vm.createContext({ window: {}, console });
const modules = new Map();
const placeholder = new Proxy(function () {}, {
  get(_target, key) {
    if (key === Symbol.toPrimitive) return () => '';
    if (key === Symbol.iterator) return function* () {};
    if (key === 'then') return undefined;
    return placeholder;
  },
  apply() { return placeholder; },
});
const poptip = value => `[[${typeof value === 'string' ? value : (value?.name || value?.id || value?.title || '')}]]`;
const noname = new vm.SyntheticModule(['lib', 'game', 'ui', 'get', 'ai', '_status'], function () {
  for (const key of ['lib', 'game', 'ui', 'ai', '_status']) this.setExport(key, placeholder);
  this.setExport('get', new Proxy({ poptip, translation: poptip }, {
    get(target, key) { return key in target ? target[key] : placeholder; },
  }));
}, { context });

async function moduleFor(filename) {
  if (modules.has(filename)) return modules.get(filename);
  if (!filename.startsWith(core + path.sep)) throw new Error(`Catalog import escaped core: ${filename}`);
  const source = await fs.readFile(filename, 'utf8');
  const mod = new vm.SourceTextModule(source, { context, identifier: filename });
  modules.set(filename, mod);
  await mod.link((specifier, parent) => {
    if (specifier === 'noname') return noname;
    if (!specifier.startsWith('.')) throw new Error(`Unsupported metadata dependency: ${specifier}`);
    return moduleFor(path.resolve(path.dirname(parent.identifier), specifier));
  });
  return mod;
}
async function load(relative) {
  const mod = await moduleFor(path.join(core, relative));
  if (mod.status !== 'evaluated') await mod.evaluate({ timeout: 5000 });
  return mod.namespace;
}

vm.runInContext(await fs.readFile(path.join(core, 'game/package.js'), 'utf8'), context, { timeout: 1000 });
const packages = context.window.noname_package;
const cardModules = new Map();
const characterModules = new Map();
const translations = {};
for (const id of Object.keys(packages.card)) {
  const data = (await load(`card/${id}.js`)).default;
  cardModules.set(id, data);
  Object.assign(translations, data.translate);
}
for (const id of Object.keys(packages.character)) {
  const characters = (await load(`character/${id}/character.js`)).default;
  const translate = (await load(`character/${id}/translate.js`)).default;
  characterModules.set(id, { characters, translate });
  // Evaluate getters only when rendering, after metadata exists.
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(translate))) {
    if (typeof descriptor.value === 'string') translations[key] = descriptor.value;
  }
}
function clean(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\[\[([^\]]*)\]\]/g, (_, id) => `〖${typeof translations[id] === 'string' ? translations[id] : id}〗`)
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}
const natureNames = { fire: '火', thunder: '雷', ice: '冰', kami: '神', stab: '刺' };
const cards = new Map();
const cardDefinitions = {};
for (const data of cardModules.values()) Object.assign(cardDefinitions, data.card || {});
function addCard(id, nature, packId, count = 0) {
  const key = `${id}|${nature || ''}`;
  if (!cards.has(key)) {
    const definition = cardDefinitions[id] || {};
    cards.set(key, {
      id, key, name: `${nature ? (natureNames[nature] || nature) : ''}${clean(translations[id]) || id}`,
      type: definition.type || 'unknown', description: clean(translations[`${id}_info`]),
      nature: nature || '', packs: [], defaultCount: 0,
      modes: Array.isArray(definition.mode) ? [...definition.mode] : [],
      forbid: Array.isArray(definition.forbid) ? [...definition.forbid] : [],
      derivation: typeof definition.derivation === 'string' ? definition.derivation : null,
    });
  }
  const entry = cards.get(key);
  if (!entry.packs.includes(packId)) entry.packs.push(packId);
  entry.defaultCount += count;
  return key;
}
const cardPacks = [];
for (const [id, data] of cardModules) {
  if (!Array.isArray(data.list)) throw new Error(`Nonstatic upstream card list: ${id}`);
  const defaults = {};
  const keys = new Set();
  for (const tuple of data.list) {
    if (!Array.isArray(tuple) || typeof tuple[2] !== 'string') throw new Error(`Invalid tuple: ${id}`);
    const key = addCard(tuple[2], typeof tuple[3] === 'string' ? tuple[3] : '', id, 1);
    defaults[key] = (defaults[key] || 0) + 1;
    keys.add(key);
  }
  for (const [name, definition] of Object.entries(data.card || {})) {
    if (definition.vanish || !['basic', 'trick', 'delay', 'equip'].includes(definition.type)) continue;
    keys.add(addCard(name, '', id));
  }
  cardPacks.push({ id, name: packages.card[id], connect: !!data.connect,
    description: clean(data.translate?.[`${id}_cardsInfo`]),
    cards: [...keys], defaults, list: data.list });
}
const characterPacks = [];
for (const [id, data] of characterModules) {
  const indexSource = await fs.readFile(path.join(core, `character/${id}/index.js`), 'utf8');
  const characters = Object.entries(data.characters).map(([name, raw]) => {
    const value = Array.isArray(raw) ? { sex: raw[0], group: raw[1], hp: raw[2], skills: raw[3] } : raw;
    return {
      id: name, name: clean(data.translate[name] || translations[name]) || name,
      faction: value.group, hp: value.hp, maxHp: value.maxHp || value.hp,
      skills: (value.skills || []).map(skill => ({ id: skill, name: clean(translations[skill]) || skill,
        description: clean(translations[`${skill}_info`]) })),
      description: (value.skills || []).map(skill => clean(translations[`${skill}_info`])).filter(Boolean).join('\n'),
      hidden: !!(value.isUnseen || value.isHiddenBoss || value.isBoss),
    };
  });
  characterPacks.push({ id, name: packages.character[id], connect: /\bconnect:\s*true\b/.test(indexSource), characters });
}
const catalog = {
  schemaVersion: 1,
  upstream: 'https://github.com/libnoname/noname',
  license: 'GPL-3.0-only',
  cardPacks, cards: [...cards.values()], characterPacks,
};
await fs.writeFile(path.join(here, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ cardPacks: cardPacks.length, cards: cards.size, characterPacks: characterPacks.length,
  characters: characterPacks.reduce((sum, pack) => sum + pack.characters.length, 0),
  output: path.join(here, 'catalog.json') }));
