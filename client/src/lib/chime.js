// A soft two-note chime when a focus timer ends (Web Audio, no sound file). Browsers only play
// sound after the user has interacted with the page, which is always true for a running timer.
export function chime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [659.25, 987.77].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.18 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 1.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 1.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    /* no sound: the screen and the notification still say it */
  }
}
