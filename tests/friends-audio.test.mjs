import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../friends-ui/audio.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const listeners = new Map(), audios = [];
  const document = {
    addEventListener(type, listener, options) { listeners.set(type, { listener, options }); },
    querySelectorAll(selector) {
      assert.equal(selector, 'audio[autoplay]');
      return audios.filter(audio => audio.autoplay);
    },
  };
  vm.runInNewContext(source, { document, WeakSet, Promise });
  return {
    audios,
    gesture(type = 'click', options = {}) { listeners.get(type).listener({ isTrusted:true, ...options }); },
  };
}

function audio(options = {}) {
  return {
    autoplay:true, paused:true, ended:false, muted:false, volume:1, duration:NaN,
    src:'/audio/background/music_default.mp3', calls:0,
    getAttribute(name) { assert.equal(name, 'src'); return this.src; },
    play() { this.calls++; this.paused=false; return Promise.resolve(); },
    ...options,
  };
}

test('an early gesture does not consume future retries, and playback can start before metadata is ready', async () => {
  const page = fixture();
  page.gesture(); // The engine has not created its music element yet.
  let finish;
  const music = audio({ play() { this.calls++; return new Promise(resolve => { finish=()=>{ this.paused=false; resolve(); }; }); } });
  page.audios.push(music);
  page.gesture();
  assert.equal(music.calls, 1);
  assert.ok(Number.isNaN(music.duration));
  page.gesture('touchend');
  assert.equal(music.calls, 1, 'do not pile up play requests while the resource is loading');
  music.duration = 100;
  finish();
  await flush();
  assert.equal(music.paused, false);
  page.gesture();
  assert.equal(music.calls, 1, 'an already playing track is not restarted');
});

test('a rejected autoplay request can be retried by the next real gesture', async () => {
  const page = fixture();
  const music = audio({ play() {
    this.calls++;
    if (this.calls === 1) return Promise.reject(Object.assign(new Error('gesture required'), { name:'NotAllowedError' }));
    this.paused=false;
    return Promise.resolve();
  } });
  page.audios.push(music);
  page.gesture();
  await flush();
  assert.equal(music.paused, true);
  page.gesture('keydown');
  await flush();
  assert.equal(music.calls, 2);
  assert.equal(music.paused, false);
});

test('user mute, zero volume, disabled music and manual audio controls remain respected', async () => {
  const page = fixture();
  page.audios.push(
    audio({ muted:true }), audio({ volume:0 }), audio({ src:'' }),
    audio({ autoplay:false }), audio({ ended:true }), audio({ paused:false }),
  );
  page.gesture();
  assert.ok(page.audios.every(item => item.calls === 0));
  assert.equal(page.audios[0].muted, true);
  assert.equal(page.audios[1].volume, 0);
  page.audios[0].muted = false;
  page.gesture('touchend');
  await flush();
  assert.equal(page.audios[0].calls, 1);
  assert.equal(page.audios[1].calls, 0);
});

test('synthetic gestures and held keys do not trigger playback, while synchronous failures allow later retries', async () => {
  const page = fixture();
  const music = audio({ play() {
    this.calls++;
    if (this.calls === 1) throw Error('not ready');
    this.paused=false;
    return Promise.resolve();
  } });
  page.audios.push(music);
  page.gesture('click', { isTrusted:false });
  page.gesture('keydown', { repeat:true });
  assert.equal(music.calls, 0);
  page.gesture();
  page.gesture('keydown');
  await flush();
  assert.equal(music.calls, 2);
  assert.equal(music.paused, false);
});
