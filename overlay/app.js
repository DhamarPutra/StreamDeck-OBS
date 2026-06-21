(() => {
  "use strict";

  // ── Config ──────────────────────────────────────
  // Auto-detect: if accessed via port 8070 or 8069 (direct local dev ports), use :9069. Otherwise use /ws path (nginx/cloudflare)
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const WS_URL =
    ["8070", "8069"].includes(location.port)
      ? `ws://${location.hostname}:9069`
      : `${wsProto}//${location.host}/ws`;
  const RECONNECT_INTERVAL = 2000;
  const SCENE_LABEL_DURATION = 3000;

  // ── DOM refs ────────────────────────────────────
  const sceneLabel = document.getElementById("scene-label");
  const sceneName = document.getElementById("scene-name");
  const mediaContainer = document.getElementById("media-container");

  // ── State ───────────────────────────────────────
  let ws = null;
  let sceneTimer = null;
  let mediaTimer = null;

  // AI Switcher (VAD) State
  let audioContext = null;
  let mediaStream = null;
  let analyserNode = null;
  let vadInterval = null;
  let silenceTimeout = null;
  let isTalking = false;

  // Speech Recognition (Voice Commands) State
  let recognition = null;
  let isListeningSpeech = false;
  let speechCommands = [];

  // Cache config for auto-restart on device change
  let lastVadConfig = null;
  let lastSpeechConfig = null;

  // Settings DOM Refs
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsContent = document.getElementById("settings-content");
  const micSelect = document.getElementById("mic-select");
  const settingsSave = document.getElementById("settings-save");

  // ── WebSocket ───────────────────────────────────
  function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[Overlay] Connected");
      const urlParams = new URLSearchParams(location.search);
      const key = urlParams.get("key") || "";
      ws.send(JSON.stringify({ type: "register", client: "overlay", key: key }));
    };

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "switch-scene":
          handleSceneSwitch(msg);
          break;
        case "show-media":
          handleShowMedia(msg);
          break;
        case "play-sound":
          handlePlaySound(msg);
          break;
        case "clear-media":
          handleClearMedia();
          break;
        case "toggle-ai-switcher":
          handleToggleAiSwitcher(msg);
          break;
        case "toggle-voice-command":
          handleToggleVoiceCommand(msg);
          break;
      }
    };

    ws.onclose = () => {
      console.log("[Overlay] Disconnected, reconnecting...");
      setTimeout(connect, RECONNECT_INTERVAL);
    };

    ws.onerror = () => ws.close();
  }

  // ── Scene Switch ────────────────────────────────
  function handleSceneSwitch(msg) {
    if (sceneTimer) {
      clearTimeout(sceneTimer);
      sceneTimer = null;
    }

    sceneName.textContent = msg.scene;
    sceneLabel.classList.remove("hidden", "exit");

    sceneTimer = setTimeout(() => {
      sceneLabel.classList.add("exit");
      setTimeout(() => {
        sceneLabel.classList.add("hidden");
        sceneLabel.classList.remove("exit");
      }, 300);
    }, SCENE_LABEL_DURATION);
  }

  // ── Show Media ──────────────────────────────────
  function handleShowMedia(msg) {
    clearMediaImmediate();

    const pos = msg.position || "center";
    mediaContainer.className = `media-container pos-${pos}`;

    const ext = msg.url.split(".").pop().toLowerCase();
    const isVideo = ["mp4", "webm"].includes(ext);

    // Create a wrapper for scale and custom X/Y positioning
    const wrapper = document.createElement("div");
    wrapper.className = "media-wrapper";
    
    const scaleFactor = (msg.scale || 100) / 100;
    if (pos === "custom") {
      wrapper.style.position = "absolute";
      wrapper.style.left = `${msg.customX ?? 50}%`;
      wrapper.style.top = `${msg.customY ?? 50}%`;
      wrapper.style.transform = `translate(-50%, -50%) scale(${scaleFactor})`;
    } else {
      wrapper.style.transform = `scale(${scaleFactor})`;
    }

    let el;
    if (isVideo && msg.chromaKey) {
      // 1. Create hidden video in background
      const video = document.createElement("video");
      video.src = msg.url;
      video.autoplay = true;
      video.loop = false;
      video.muted = false;
      video.playsInline = true;
      video.style.display = "none";
      document.body.appendChild(video);

      // 2. Create canvas to render to screen
      el = document.createElement("canvas");
      el.className = "media-element media-element-canvas";
      wrapper.appendChild(el);

      const ctx = el.getContext("2d", { willReadFrequently: true });
      
      video.addEventListener("loadedmetadata", () => {
        el.width = video.videoWidth;
        el.height = video.videoHeight;
      });

      // 3. Process green screen frame loop
      let animationFrameId;
      const processFrame = () => {
        if (video.paused || video.ended) {
          video.remove();
          return;
        }
        ctx.drawImage(video, 0, 0, el.width, el.height);
        try {
          const frame = ctx.getImageData(0, 0, el.width, el.height);
          const l = frame.data.length / 4;
          for (let i = 0; i < l; i++) {
            const r = frame.data[i * 4 + 0];
            const g = frame.data[i * 4 + 1];
            const b = frame.data[i * 4 + 2];
            // Key out green pixels
            if (g > 90 && g > r * 1.35 && g > b * 1.35) {
              frame.data[i * 4 + 3] = 0;
            }
          }
          ctx.putImageData(frame, 0, 0);
        } catch (e) {
          // Prevent cross-origin exceptions
        }
        animationFrameId = requestAnimationFrame(processFrame);
      };

      video.addEventListener("play", () => {
        processFrame();
      });

      el.cleanup = () => {
        cancelAnimationFrame(animationFrameId);
        video.pause();
        video.remove();
      };
    } else if (isVideo) {
      el = document.createElement("video");
      el.src = msg.url;
      el.className = "media-element";
      el.autoplay = true;
      el.loop = false;
      el.muted = false;
      el.playsInline = true;
      wrapper.appendChild(el);
    } else {
      el = document.createElement("img");
      el.src = msg.url;
      el.className = "media-element";
      el.alt = "Media";
      wrapper.appendChild(el);
    }

    mediaContainer.appendChild(wrapper);
    mediaContainer.classList.remove("hidden");

    const duration = msg.duration || 5000;
    mediaTimer = setTimeout(() => hideMedia(el), duration);
  }

  // ── Play Sound ──────────────────────────────────
  function handlePlaySound(msg) {
    const audio = document.createElement("audio");
    audio.src = msg.url;
    audio.volume = Math.min(1, Math.max(0, msg.volume ?? 0.8));
    audio.style.display = "none";
    document.body.appendChild(audio);

    audio.play().catch((err) => {
      console.warn("[Overlay] Audio play failed:", err.message);
      audio.remove();
    });

    audio.addEventListener("ended", () => audio.remove());
    audio.addEventListener("error", () => audio.remove());
  }

  // ── Hide Media (animated) ──────────────────────
  function hideMedia(el) {
    if (!el) return;
    el.classList.add("exit");
    setTimeout(() => clearMediaImmediate(), 350);
  }

  // ── Clear Media (immediate) ────────────────────
  function clearMediaImmediate() {
    if (mediaTimer) {
      clearTimeout(mediaTimer);
      mediaTimer = null;
    }
    mediaContainer.querySelectorAll(".media-element").forEach((el) => {
      if (typeof el.cleanup === "function") el.cleanup();
    });
    mediaContainer.innerHTML = "";
    mediaContainer.classList.add("hidden");
    mediaContainer.className = "media-container hidden";
  }

  function handleClearMedia() {
    const el = mediaContainer.querySelector(".media-element");
    if (el) hideMedia(el);
    else clearMediaImmediate();
  }

  // ── Audio VAD AI Auto-Pilot ─────────────────────
  function handleToggleAiSwitcher(msg) {
    stopVAD();
    if (msg.active) {
      startVAD(msg.talkScene, msg.quietScene, msg.threshold, msg.delay);
    }
  }

  function startVAD(talkScene, quietScene, threshold, silenceDelay) {
    console.log(`[VAD] Starting VAD: Talk = "${talkScene}", Quiet = "${quietScene}", Threshold = ${threshold}%, Delay = ${silenceDelay}ms`);
    lastVadConfig = { active: true, talkScene, quietScene, threshold, silenceDelay };

    const micId = localStorage.getItem("overlay-mic-id");
    const constraints = {
      audio: micId ? { deviceId: { exact: micId } } : true
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => {
        mediaStream = stream;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 512;
        source.connect(analyserNode);

        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        vadInterval = setInterval(() => {
          if (!analyserNode) return;
          analyserNode.getByteFrequencyData(dataArray);

          // Vocal frequencies: ~85Hz to ~1000Hz
          // With 44100Hz sample rate and fftSize 512, each bin is ~86Hz
          // Bins 1 to 12 cover ~86Hz to ~1032Hz
          let sum = 0;
          const startBin = 1;
          const endBin = 12;
          for (let i = startBin; i <= endBin; i++) {
            sum += dataArray[i];
          }
          const average = sum / (endBin - startBin + 1);
          const percentage = Math.round((average / 255) * 100);

          if (percentage >= threshold) {
            // Talking detected
            if (silenceTimeout) {
              clearTimeout(silenceTimeout);
              silenceTimeout = null;
            }
            if (!isTalking) {
              isTalking = true;
              console.log(`[VAD] Speech detected: ${percentage}% >= ${threshold}%. Switching to: ${talkScene}`);
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "switch-scene", scene: talkScene }));
              }
            }
          } else {
            // Silence detected
            if (isTalking) {
              if (!silenceTimeout) {
                console.log(`[VAD] Silence detected: ${percentage}% < ${threshold}%. Delay timer started (${silenceDelay}ms)`);
                silenceTimeout = setTimeout(() => {
                  isTalking = false;
                  silenceTimeout = null;
                  console.log(`[VAD] Silence delay expired. Switching to: ${quietScene}`);
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "switch-scene", scene: quietScene }));
                  }
                }, silenceDelay);
              }
            }
          }
        }, 100);
      })
      .catch((err) => {
        console.error("[VAD] Failed to access microphone:", err);
      });
  }

  function stopVAD() {
    lastVadConfig = { active: false };
    console.log("[VAD] Stopping VAD");
    if (vadInterval) {
      clearInterval(vadInterval);
      vadInterval = null;
    }
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }
    isTalking = false;
    if (audioContext) {
      audioContext.close().catch((e) => console.error("[VAD] AudioContext close error:", e));
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    analyserNode = null;
  }

  // ── Voice Commands (STT) ────────────────────────
  function handleToggleVoiceCommand(msg) {
    stopSpeechRecognition();
    if (msg.active && msg.commands && msg.commands.length > 0) {
      startSpeechRecognition(msg.commands);
    }
  }

  function startSpeechRecognition(commands) {
    console.log("[Speech] Starting speech recognition. Commands available:", commands);
    lastSpeechConfig = { active: true, commands };
    speechCommands = commands;
    isListeningSpeech = true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[Speech] Web Speech API is not supported in this browser.");
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "id-ID";

    recognition.onresult = (event) => {
      if (!isListeningSpeech) return;
      const resultIndex = event.resultIndex;
      const transcript = event.results[resultIndex][0].transcript.trim().toLowerCase();
      console.log(`[Speech] Result: "${transcript}"`);

      // Match transcript with the commands using fuzzy containment matching
      const matched = speechCommands.find((cmd) => {
        const phrase = cmd.phrase.toLowerCase();
        return transcript.includes(phrase);
      });

      if (matched) {
        console.log(`[Speech] Match found! Phrase: "${matched.phrase}" -> Switch to scene: "${matched.scene}"`);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "switch-scene", scene: matched.scene }));
        }
      }
    };

    recognition.onerror = (event) => {
      console.error("[Speech] Recognition error:", event.error);
      if (event.error === "not-allowed") {
        isListeningSpeech = false;
      }
    };

    recognition.onend = () => {
      console.log("[Speech] Recognition ended.");
      if (isListeningSpeech) {
        console.log("[Speech] Auto-restarting recognition loop in 1s...");
        setTimeout(() => {
          if (!isListeningSpeech) return;
          try {
            recognition.start();
          } catch (e) {
            console.error("[Speech] Failed to restart recognition:", e);
          }
        }, 1000);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error("[Speech] Failed to start recognition:", e);
    }
  }

  function stopSpeechRecognition() {
    lastSpeechConfig = { active: false };
    console.log("[Speech] Stopping speech recognition");
    isListeningSpeech = false;
    speechCommands = [];
    if (recognition) {
      // Clear event handlers to prevent asynchronous race conditions
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch (e) {
        // Already stopped or not started
      }
      recognition = null;
    }
  }

  // ── Settings Panel Logic ────────────────────────
  if (settingsToggle && settingsContent && micSelect && settingsSave) {
    settingsToggle.addEventListener("click", () => {
      const isHidden = settingsContent.classList.toggle("hidden");
      if (!isHidden) {
        populateMicSelect();
      }
    });

    settingsSave.addEventListener("click", () => {
      const savedId = micSelect.value;
      localStorage.setItem("overlay-mic-id", savedId);
      settingsContent.classList.add("hidden");
      console.log("[Settings] Saved microphone ID:", savedId);

      // Restart active VAD if running
      if (lastVadConfig && lastVadConfig.active) {
        console.log("[Settings] Restarting VAD with new microphone...");
        const currentVAD = { ...lastVadConfig };
        stopVAD();
        startVAD(currentVAD.talkScene, currentVAD.quietScene, currentVAD.threshold, currentVAD.delay);
      }

      // Restart Speech Recognition if running
      if (lastSpeechConfig && lastSpeechConfig.active) {
        console.log("[Settings] Restarting Speech Recognition with new microphone...");
        const currentSpeech = { ...lastSpeechConfig };
        stopSpeechRecognition();
        startSpeechRecognition(currentSpeech.commands);
      }
    });
  }

  function populateMicSelect() {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => {
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        const currentVal = localStorage.getItem("overlay-mic-id") || "";
        micSelect.innerHTML = '<option value="">Default Microphone</option>';
        
        const audioInputs = devices.filter(d => d.kind === "audioinput");
        audioInputs.forEach((d) => {
          const opt = document.createElement("option");
          opt.value = d.deviceId;
          opt.textContent = d.label || `Microphone (${d.deviceId.slice(0, 5)}...)`;
          if (d.deviceId === currentVal) {
            opt.selected = true;
          }
          micSelect.appendChild(opt);
        });
      })
      .catch((err) => {
        console.error("[Settings] Error populating microphones:", err);
      });
  }

  // ── Init ────────────────────────────────────────
  connect();
})();
