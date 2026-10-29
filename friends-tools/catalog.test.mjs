import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
const cards = new Map(catalog.cards.map(card => [card.key, card]));

test('all exported card defaults exactly reflect upstream physical deck lists', () => {
  for (const pack of catalog.cardPacks) {
    const counts = {};
    for (const tuple of pack.list) {
      const key = `${tuple[2]}|${typeof tuple[3] === 'string' ? tuple[3] : ''}`;
      assert.ok(cards.has(key), `${pack.id}: missing ${key}`);
      counts[key] = (counts[key] || 0) + 1;
    }
    assert.deepEqual(pack.defaults, counts, pack.id);
    assert.equal(Object.values(pack.defaults).reduce((a, b) => a + b, 0), pack.list.length);
  }
});

test('standard and military expansion decks retain authoritative totals and elemental variants', () => {
  assert.equal(catalog.cardPacks.find(pack => pack.id === 'standard').list.length, 108);
  assert.equal(catalog.cardPacks.find(pack => pack.id === 'extra').list.length, 53);
  assert.equal(cards.get('sha|fire').name, '火杀');
  assert.equal(cards.get('sha|thunder').name, '雷杀');
  assert.equal(cards.get('sha|ice').name, '冰杀');
});

test('expansion-specific physical card tags are retained', () => {
  const yingbian = catalog.cardPacks.find(pack => pack.id === 'yingbian');
  assert.ok(yingbian.list.some(tuple => Array.isArray(tuple[4]) && tuple[4].some(tag => tag.startsWith('yingbian_'))));
  const jiubian = catalog.cardPacks.find(pack => pack.id === 'jiubian');
  assert.equal(jiubian.list.length, 52);
  assert.ok(jiubian.list.some(tuple => Array.isArray(tuple[4]) && tuple[4].includes('guo')));
});

test('all defined card and general records have explicit identifiers and readable names', () => {
  assert.equal(cards.size, catalog.cards.length);
  for (const card of catalog.cards) {
    assert.ok(card.id && card.key && card.name && card.type !== 'unknown');
    assert.ok(card.packs.every(id => catalog.cardPacks.some(pack => pack.id === id)));
  }
  for (const pack of catalog.characterPacks) {
    assert.equal(new Set(pack.characters.map(character => character.id)).size, pack.characters.length);
    for (const character of pack.characters) {
      assert.ok(character.id && character.name && character.faction);
      assert.ok(character.hp !== undefined);
    }
  }
  assert.ok(catalog.characterPacks.some(pack => pack.id === 'standard'));
  assert.ok(catalog.characterPacks.some(pack => pack.id === 'refresh'));
  assert.ok(catalog.characterPacks.some(pack => pack.id === 'mobile'));
  assert.ok(catalog.characterPacks.some(pack => pack.id === 'onlyOL'));
});
