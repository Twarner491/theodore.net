(function () {
  "use strict";

  var voiceButton = document.getElementById("hw-voice");
  var faxButton = document.getElementById("hw-fax");
  if (!voiceButton || !faxButton || voiceButton.dataset.ready === "true") return;
  voiceButton.dataset.ready = "true";

  var preferredVoices = [
    "Samantha",
    "Ava",
    "Serena",
    "Allison",
    "Karen",
    "Moira",
    "Susan",
    "Kate",
    "Zira",
    "Google US English",
    "Google UK English Female",
    "Microsoft Aria Online (Natural)",
    "Microsoft Jenny Online (Natural)"
  ];

  function pickVoice() {
    if (!("speechSynthesis" in window)) return null;
    var voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    for (var index = 0; index < preferredVoices.length; index += 1) {
      var exact = voices.find(function (voice) {
        return voice.name === preferredVoices[index];
      });
      if (exact) return exact;
    }

    var natural = voices.find(function (voice) {
      return /(natural|enhanced|premium|neural)/i.test(voice.name) && /^en/i.test(voice.lang);
    });
    if (natural) return natural;

    return voices.find(function (voice) {
      return /^en-(US|GB)/i.test(voice.lang);
    }) || voices.find(function (voice) {
      return /^en/i.test(voice.lang);
    }) || voices[0];
  }

  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
  }

  voiceButton.addEventListener("click", function () {
    if (!("speechSynthesis" in window)) {
      voiceButton.classList.add("is-unsupported");
      return;
    }

    var speech = window.speechSynthesis;
    speech.cancel();

    var utterance = new SpeechSynthesisUtterance("hello world");
    var voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.92;
    utterance.pitch = 1.08;
    utterance.volume = 1;

    voiceButton.classList.add("is-playing");
    function clearPlayingState() {
      voiceButton.classList.remove("is-playing");
    }
    utterance.onend = clearPlayingState;
    utterance.onerror = clearPlayingState;
    window.setTimeout(function () {
      speech.speak(utterance);
    }, 0);
  });

  var faxMessage = "hello world";
  var faxMark = 1650;
  var faxSpace = 1850;
  var faxBaud = 100;
  var faxCedDuration = 0.75;
  var faxGapDuration = 0.12;
  var audioContext = null;
  var audioOutput = null;
  var bridgeElement = null;
  var faxBufferPromise = null;
  var activeFaxSource = null;
  var faxFallbackTimer = 0;
  var isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function getAudioContext() {
    if (audioContext) return audioContext;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    audioContext = new AudioContextClass();
    audioOutput = audioContext.destination;

    if (isIOS) {
      try {
        var destination = audioContext.createMediaStreamDestination();
        bridgeElement = document.createElement("audio");
        bridgeElement.setAttribute("playsinline", "");
        bridgeElement.setAttribute("webkit-playsinline", "");
        bridgeElement.srcObject = destination.stream;
        audioOutput = destination;
      } catch (error) {
        bridgeElement = null;
        audioOutput = audioContext.destination;
      }
    }

    return audioContext;
  }

  function primeBridge() {
    if (!bridgeElement || !bridgeElement.paused) return;
    var playPromise = bridgeElement.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {});
    }
  }

  function buildFaxBits() {
    var bits = [];
    var index;
    for (index = 0; index < 16; index += 1) bits.push(index % 2);

    for (index = 0; index < faxMessage.length; index += 1) {
      var code = faxMessage.charCodeAt(index);
      for (var bit = 7; bit >= 0; bit -= 1) bits.push((code >> bit) & 1);
    }
    return bits;
  }

  function renderFaxBuffer() {
    var OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineAudioContextClass) return Promise.resolve(null);

    var sampleRate = 44100;
    var bits = buildFaxBits();
    var bitDuration = 1 / faxBaud;
    var fskDuration = bits.length * bitDuration;
    var totalDuration = faxCedDuration + faxGapDuration + fskDuration + 0.05;
    var offline;

    try {
      offline = new OfflineAudioContextClass(1, Math.ceil(totalDuration * sampleRate), sampleRate);
    } catch (error) {
      return Promise.resolve(null);
    }

    var cedOscillator = offline.createOscillator();
    var cedGain = offline.createGain();
    var cedFade = 0.012;
    cedOscillator.type = "sine";
    cedOscillator.frequency.value = 2100;
    cedOscillator.connect(cedGain);
    cedGain.connect(offline.destination);
    cedGain.gain.setValueAtTime(0, 0);
    cedGain.gain.linearRampToValueAtTime(0.22, cedFade);
    cedGain.gain.setValueAtTime(0.22, faxCedDuration - cedFade);
    cedGain.gain.linearRampToValueAtTime(0, faxCedDuration);
    cedOscillator.start(0);
    cedOscillator.stop(faxCedDuration + 0.02);

    var fskStart = faxCedDuration + faxGapDuration;
    var fskOscillator = offline.createOscillator();
    var fskGain = offline.createGain();
    var fskFade = 0.01;
    fskOscillator.type = "sine";
    fskOscillator.frequency.value = bits[0] ? faxMark : faxSpace;
    fskOscillator.connect(fskGain);
    fskGain.connect(offline.destination);

    for (var index = 1; index < bits.length; index += 1) {
      fskOscillator.frequency.setValueAtTime(
        bits[index] ? faxMark : faxSpace,
        fskStart + index * bitDuration
      );
    }

    fskGain.gain.setValueAtTime(0, fskStart);
    fskGain.gain.linearRampToValueAtTime(0.25, fskStart + fskFade);
    fskGain.gain.setValueAtTime(0.25, fskStart + fskDuration - fskFade);
    fskGain.gain.linearRampToValueAtTime(0, fskStart + fskDuration);
    fskOscillator.start(fskStart);
    fskOscillator.stop(fskStart + fskDuration + 0.02);

    return offline.startRendering();
  }

  function ensureFaxBuffer() {
    if (!faxBufferPromise) {
      faxBufferPromise = renderFaxBuffer().catch(function () {
        return null;
      });
    }
    return faxBufferPromise;
  }

  function stopFax() {
    if (faxFallbackTimer) {
      window.clearTimeout(faxFallbackTimer);
      faxFallbackTimer = 0;
    }
    if (activeFaxSource) {
      try { activeFaxSource.onended = null; } catch (error) {}
      try { activeFaxSource.stop(); } catch (error) {}
      try { activeFaxSource.disconnect(); } catch (error) {}
      activeFaxSource = null;
    }
    faxButton.classList.remove("is-playing");
  }

  ensureFaxBuffer();

  faxButton.addEventListener("click", function () {
    if (faxButton.classList.contains("is-playing")) {
      stopFax();
      return;
    }

    var context = getAudioContext();
    if (!context) {
      faxButton.classList.add("is-unsupported");
      return;
    }

    primeBridge();
    if (context.state === "suspended") context.resume();
    faxButton.classList.add("is-playing");

    ensureFaxBuffer().then(function (buffer) {
      if (!buffer) {
        faxButton.classList.remove("is-playing");
        faxButton.classList.add("is-unsupported");
        return;
      }
      if (!faxButton.classList.contains("is-playing")) return;

      var source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(audioOutput);

      function cleanup() {
        if (activeFaxSource !== source) return;
        if (faxFallbackTimer) {
          window.clearTimeout(faxFallbackTimer);
          faxFallbackTimer = 0;
        }
        activeFaxSource = null;
        faxButton.classList.remove("is-playing");
        try { source.disconnect(); } catch (error) {}
      }

      source.onended = cleanup;
      activeFaxSource = source;
      source.start();
      faxFallbackTimer = window.setTimeout(function () {
        if (activeFaxSource === source) {
          try { source.stop(); } catch (error) {}
          cleanup();
        }
      }, (buffer.duration + 0.5) * 1000);
    });
  });
})();
