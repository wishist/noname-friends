// Retry browser-blocked autoplay during a user gesture, including before metadata loads.
// Keep the engine's sources, sound switches and volume settings unchanged.
(() => {
  const pending = new WeakSet();
  function resumeAudio(event) {
    if (!event.isTrusted || event.repeat) return;
    for (const audio of document.querySelectorAll('audio[autoplay]')) {
      if (!audio.paused || audio.ended || audio.muted || audio.volume <= 0 || !audio.getAttribute('src') || pending.has(audio)) continue;
      pending.add(audio);
      try {
        Promise.resolve(audio.play()).catch(() => {}).finally(() => pending.delete(audio));
      } catch {
        pending.delete(audio);
      }
    }
  }
  // A one-shot listener can be consumed before the music element or resource is ready.
  // Capture also sees gestures in game menus that stop event propagation.
  for (const type of ['click', 'touchend', 'keydown']) document.addEventListener(type, resumeAudio, { capture:true, passive:true });
})();
