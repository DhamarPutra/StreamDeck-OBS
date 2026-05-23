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

  // ── Init ────────────────────────────────────────
  connect();
})();
