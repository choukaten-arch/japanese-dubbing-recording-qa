(() => {
  "use strict";

  const profiles = Object.freeze({
    "コツコツ": { kind: "knock", count: 4, interval: 0.17, pitch: 270 },
    "ギイッ": { kind: "creak", duration: 0.72, pitch: 170 },
    "カタッ": { kind: "knock", count: 1, interval: 0.16, pitch: 340 },
    "シュッシュッ": { kind: "whoosh", count: 2, interval: 0.38, duration: 0.28 },
    "パチパチ": { kind: "crackle", count: 8, interval: 0.09 },
    "バタン": { kind: "impact", pitch: 72, duration: 0.42 },
    "カンッ": { kind: "metal", pitch: 920, duration: 0.34 },
    "カーン": { kind: "bell", pitch: 690, duration: 1.15 },
    "ガチャッ": { kind: "rattle", count: 3, interval: 0.07, pitch: 520 },
    "カチャン": { kind: "metal", pitch: 780, duration: 0.52 },
    "タタタッ": { kind: "footstep", count: 5, interval: 0.11, pitch: 112 },
    "ビュン": { kind: "whoosh", count: 1, duration: 0.52, pitch: 1150 },
    "ヒュウヒュウ": { kind: "wind", duration: 1.25, pitch: 920 },
    "ザーザー": { kind: "rain", duration: 1.2, pitch: 3200 },
    "ゴロゴロ": { kind: "thunder", duration: 1.3, pitch: 54 },
    "チーン": { kind: "bell", pitch: 1050, duration: 0.92 },
    "トコトコ": { kind: "footstep", count: 4, interval: 0.22, pitch: 94 },
    "ポンッ": { kind: "ball", count: 1, interval: 0.2, pitch: 150 },
    "ダダッ": { kind: "footstep", count: 3, interval: 0.13, pitch: 82 },
    "チリン": { kind: "bell", pitch: 1460, duration: 0.62 },
    "ガサガサ": { kind: "rustle", count: 4, interval: 0.16, pitch: 2200 },
    "ドタドタ": { kind: "footstep", count: 4, interval: 0.17, pitch: 66 },
    "カラン": { kind: "metal", pitch: 620, duration: 0.48 },
    "プッ": { kind: "puff", duration: 0.24, pitch: 760 },
    "パシャッ": { kind: "splash", duration: 0.4, pitch: 2300 },
    "ガタン": { kind: "impact", pitch: 62, duration: 0.48 },
    "ドテッ": { kind: "impact", pitch: 52, duration: 0.5 },
    "バシャーン": { kind: "splash", duration: 0.82, pitch: 1700 },
    "ワイワイ": { kind: "vocal", count: 5, interval: 0.14, pitch: 230 },
    "シーン": { kind: "quiet", duration: 0.9, pitch: 1800 },
    "フフフ": { kind: "vocal", count: 3, interval: 0.18, pitch: 175 },
    "フゥー": { kind: "wind", duration: 0.78, pitch: 640 },
    "ガオーッ": { kind: "vocal", count: 1, interval: 0.2, pitch: 105, duration: 0.9 },
    "バサバサ": { kind: "rustle", count: 4, interval: 0.2, pitch: 1300 },
    "オギャー": { kind: "vocal", count: 2, interval: 0.34, pitch: 360, duration: 0.3 },
    "ヨシヨシ": { kind: "vocal", count: 4, interval: 0.21, pitch: 205 },
    "ガタガタ": { kind: "rattle", count: 7, interval: 0.1, pitch: 360 },
    "パサッ": { kind: "rustle", count: 1, interval: 0.16, pitch: 1900 },
    "カリカリ": { kind: "scratch", count: 5, interval: 0.12, pitch: 3100 },
    "スッ": { kind: "whoosh", count: 1, duration: 0.3, pitch: 1900 },
    "スタスタ": { kind: "footstep", count: 4, interval: 0.18, pitch: 105 },
    "ガヤガヤ": { kind: "vocal", count: 7, interval: 0.11, pitch: 195 },
    "ブツブツ": { kind: "vocal", count: 5, interval: 0.17, pitch: 145 },
    "ゴトン": { kind: "impact", pitch: 58, duration: 0.4 },
    "モワッ": { kind: "whoosh", count: 1, duration: 0.68, pitch: 520 },
    "パタパタ": { kind: "rustle", count: 4, interval: 0.17, pitch: 1550 },
    "ワハハ": { kind: "vocal", count: 3, interval: 0.2, pitch: 185 },
    "サラサラ": { kind: "water", duration: 1, pitch: 2400 },
    "ギッコン": { kind: "creak", duration: 0.85, pitch: 145 },
    "ジャージャー": { kind: "water", duration: 1.2, pitch: 1850 },
    "サッサッ": { kind: "rustle", count: 3, interval: 0.22, pitch: 2450 },
    "ゴトゴト": { kind: "knock", count: 4, interval: 0.19, pitch: 120 },
    "アハハ": { kind: "vocal", count: 3, interval: 0.2, pitch: 220 },
  });

  const runtime = {
    context: null,
    sources: [],
    master: null,
    cleanupTimer: null,
  };

  function profileFor(word) {
    return profiles[String(word || "").trim()] || { kind: "knock", count: 2, interval: 0.18, pitch: 220 };
  }

  function hasProfile(word) {
    return Object.hasOwn(profiles, String(word || "").trim());
  }

  function audioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("AudioContext unavailable");
    if (!runtime.context || runtime.context.state === "closed") runtime.context = new AudioContextClass();
    return runtime.context;
  }

  function trackSource(source, start, end) {
    runtime.sources.push(source);
    source.start(start);
    source.stop(end + 0.04);
  }

  function scheduleTone(context, output, start, duration, options = {}) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequency = Math.max(20, options.frequency || 220);
    const endFrequency = Math.max(20, options.endFrequency || frequency);
    const peak = Math.max(0.001, options.gain || 0.12);
    const attack = Math.min(duration * 0.35, options.attack || 0.008);
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(output);
    trackSource(oscillator, start, start + duration);
  }

  function scheduleNoise(context, output, start, duration, options = {}) {
    const frameCount = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) channel[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const frequency = Math.max(40, options.frequency || 1800);
    const endFrequency = Math.max(40, options.endFrequency || frequency);
    const peak = Math.max(0.001, options.gain || 0.1);
    const attack = Math.min(duration * 0.35, options.attack || 0.01);
    source.buffer = buffer;
    filter.type = options.filterType || "bandpass";
    filter.Q.value = options.q || 0.8;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(output);
    trackSource(source, start, start + duration);
  }

  function scheduleBell(context, output, start, profile) {
    [1, 2.03, 3.97].forEach((multiple, index) => {
      scheduleTone(context, output, start, profile.duration, {
        frequency: profile.pitch * multiple,
        endFrequency: profile.pitch * multiple * 0.985,
        gain: [0.15, 0.065, 0.025][index],
      });
    });
    scheduleNoise(context, output, start, 0.06, { frequency: 4200, gain: 0.045 });
    return profile.duration;
  }

  function scheduleProfile(context, output, start, profile) {
    const count = profile.count || 1;
    const interval = profile.interval || 0.18;
    const pitch = profile.pitch || 220;
    const duration = profile.duration || 0.18;
    switch (profile.kind) {
      case "bell":
        return scheduleBell(context, output, start, profile);
      case "metal":
        scheduleTone(context, output, start, duration, { frequency: pitch, endFrequency: pitch * 0.96, gain: 0.13 });
        scheduleTone(context, output, start, duration * 0.82, { frequency: pitch * 2.35, gain: 0.055 });
        scheduleNoise(context, output, start, 0.07, { frequency: 3900, gain: 0.04 });
        return duration;
      case "knock":
        for (let index = 0; index < count; index += 1) {
          const hit = start + index * interval;
          scheduleTone(context, output, hit, 0.08, { frequency: pitch * 1.7, endFrequency: pitch, type: "triangle", gain: 0.13 });
          scheduleNoise(context, output, hit, 0.045, { frequency: 1250, gain: 0.035 });
        }
        return (count - 1) * interval + 0.12;
      case "impact":
        scheduleTone(context, output, start, duration, { frequency: pitch * 1.8, endFrequency: pitch, type: "triangle", gain: 0.19 });
        scheduleNoise(context, output, start, Math.min(0.22, duration), { filterType: "lowpass", frequency: 720, endFrequency: 160, gain: 0.15 });
        return duration;
      case "footstep":
      case "ball":
        for (let index = 0; index < count; index += 1) {
          const hit = start + index * interval;
          scheduleTone(context, output, hit, 0.1, { frequency: pitch * 1.65, endFrequency: pitch, type: "triangle", gain: profile.kind === "ball" ? 0.16 : 0.12 });
          scheduleNoise(context, output, hit, 0.06, { filterType: "lowpass", frequency: 620, gain: 0.055 });
        }
        return (count - 1) * interval + 0.14;
      case "creak":
        scheduleTone(context, output, start, duration, { frequency: pitch, endFrequency: pitch * 2.15, type: "sawtooth", gain: 0.055, attack: 0.08 });
        scheduleNoise(context, output, start, duration, { frequency: 1150, endFrequency: 480, gain: 0.035, attack: 0.08 });
        return duration;
      case "rattle":
        for (let index = 0; index < count; index += 1) {
          const hit = start + index * interval;
          scheduleTone(context, output, hit, 0.09, { frequency: pitch * (1 + index * 0.12), type: "square", gain: 0.055 });
          scheduleNoise(context, output, hit, 0.06, { frequency: 2600, gain: 0.04 });
        }
        return (count - 1) * interval + 0.14;
      case "rustle":
      case "scratch":
        for (let index = 0; index < count; index += 1) {
          scheduleNoise(context, output, start + index * interval, profile.kind === "scratch" ? 0.1 : 0.15, {
            filterType: "bandpass",
            frequency: pitch * (index % 2 ? 0.82 : 1),
            endFrequency: pitch * (index % 2 ? 1.15 : 0.72),
            q: profile.kind === "scratch" ? 3.2 : 0.9,
            gain: profile.kind === "scratch" ? 0.07 : 0.095,
          });
        }
        return (count - 1) * interval + 0.2;
      case "whoosh":
        for (let index = 0; index < count; index += 1) {
          scheduleNoise(context, output, start + index * interval, duration, {
            frequency: pitch * 0.45,
            endFrequency: pitch * 1.65,
            q: 1.2,
            gain: 0.11,
            attack: duration * 0.38,
          });
        }
        return (count - 1) * interval + duration;
      case "wind":
        scheduleNoise(context, output, start, duration, { frequency: pitch * 0.62, endFrequency: pitch * 1.4, q: 1.4, gain: 0.085, attack: 0.18 });
        scheduleTone(context, output, start + 0.12, duration * 0.72, { frequency: pitch * 0.42, endFrequency: pitch * 0.58, type: "sine", gain: 0.025, attack: 0.18 });
        return duration;
      case "rain":
        scheduleNoise(context, output, start, duration, { filterType: "highpass", frequency: pitch, endFrequency: pitch * 0.72, gain: 0.085, attack: 0.12 });
        for (let index = 0; index < 8; index += 1) scheduleNoise(context, output, start + index * 0.13, 0.04, { frequency: 5200, gain: 0.045 });
        return duration;
      case "crackle":
        for (let index = 0; index < count; index += 1) {
          const hit = start + index * interval + (index % 3) * 0.018;
          scheduleNoise(context, output, hit, 0.045, { frequency: 4300 - index * 120, gain: 0.075 });
        }
        return (count - 1) * interval + 0.1;
      case "thunder":
        scheduleTone(context, output, start, duration, { frequency: pitch * 1.8, endFrequency: pitch * 0.62, type: "sawtooth", gain: 0.12, attack: 0.04 });
        scheduleNoise(context, output, start, duration, { filterType: "lowpass", frequency: 420, endFrequency: 90, gain: 0.14, attack: 0.03 });
        return duration;
      case "splash":
      case "water":
        scheduleNoise(context, output, start, duration, {
          filterType: "bandpass",
          frequency: pitch,
          endFrequency: profile.kind === "splash" ? pitch * 0.42 : pitch * 0.76,
          q: 0.6,
          gain: profile.kind === "splash" ? 0.16 : 0.09,
          attack: profile.kind === "splash" ? 0.01 : 0.14,
        });
        if (profile.kind === "splash") scheduleTone(context, output, start, duration * 0.6, { frequency: 420, endFrequency: 145, type: "triangle", gain: 0.045 });
        return duration;
      case "puff":
        scheduleNoise(context, output, start, duration, { filterType: "lowpass", frequency: pitch, endFrequency: pitch * 0.35, gain: 0.13 });
        return duration;
      case "vocal":
        for (let index = 0; index < count; index += 1) {
          const voiceStart = start + index * interval;
          const voiceDuration = profile.duration || Math.min(0.17, interval * 0.86);
          scheduleTone(context, output, voiceStart, voiceDuration, {
            frequency: pitch * (index % 2 ? 1.12 : 1),
            endFrequency: pitch * (index % 2 ? 0.94 : 1.18),
            type: "sawtooth",
            gain: 0.045,
            attack: 0.025,
          });
          scheduleTone(context, output, voiceStart, voiceDuration, { frequency: pitch * 2.2, endFrequency: pitch * 2.35, gain: 0.022, attack: 0.025 });
        }
        return (count - 1) * interval + (profile.duration || 0.19);
      case "quiet":
        scheduleTone(context, output, start, duration, { frequency: pitch, endFrequency: pitch * 1.04, gain: 0.008, attack: 0.28 });
        return duration;
      default:
        return 0.4;
    }
  }

  function stop() {
    clearTimeout(runtime.cleanupTimer);
    runtime.sources.forEach((source) => {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    });
    runtime.sources = [];
    try { runtime.master?.disconnect(); } catch {}
    runtime.master = null;
  }

  async function play(word) {
    stop();
    const context = audioContext();
    await context.resume();
    const master = context.createGain();
    master.gain.value = 0.72;
    master.connect(context.destination);
    runtime.master = master;
    const profile = profileFor(word);
    const duration = scheduleProfile(context, master, context.currentTime + 0.025, profile);
    runtime.cleanupTimer = setTimeout(() => {
      runtime.sources = [];
      try { master.disconnect(); } catch {}
      if (runtime.master === master) runtime.master = null;
    }, Math.ceil((duration + 0.2) * 1000));
    return { duration, kind: profile.kind };
  }

  window.QASoundDemo = Object.freeze({
    play,
    stop,
    profileFor,
    hasProfile,
    words: Object.freeze(Object.keys(profiles)),
  });
})();
