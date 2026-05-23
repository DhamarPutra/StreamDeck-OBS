(() => {
  "use strict";

  // ── Config ──────────────────────────────────────
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const WS_BASE =
    location.port === "8069"
      ? `ws://${location.hostname}:9069`
      : `${wsProto}//${location.host}/ws`;
  const API = "";
  const RECONNECT_INTERVAL = 2000;

  // ── State ───────────────────────────────────────
  let ws = null;
  let buttons = [];
  let activeScene = null;
  let mediaFiles = [];
  let obsConnected = false;
  let accessKey = localStorage.getItem("deck-access-key") || "";

  // ── DOM refs ────────────────────────────────────
  const loginScreen = document.getElementById("login-screen");
  const loginForm = document.getElementById("login-form");
  const loginUsernameInput = document.getElementById("login-username");
  const loginPasswordInput = document.getElementById("login-password");
  const authTitle = document.getElementById("auth-title");
  const authDesc = document.getElementById("auth-desc");
  const authSubmitBtn = document.getElementById("auth-submit-btn");
  const authSwitchText = document.getElementById("auth-switch-text");
  const authSwitchLink = document.getElementById("auth-switch-link");
  const loginError = document.getElementById("login-error");
  const mainApp = document.getElementById("main-app");

  const grid = document.getElementById("button-grid");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const obsDot = document.getElementById("obs-dot");
  const remoteBtn = document.getElementById("remote-btn");
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsOverlay = document.getElementById("settings-overlay");
  const settingsClose = document.getElementById("settings-close");

  // Access key
  const accessKeyForm = document.getElementById("access-key-form");

  // OBS form
  const obsForm = document.getElementById("obs-form");
  const obsHost = document.getElementById("obs-host");
  const obsPort = document.getElementById("obs-port");
  const obsPassword = document.getElementById("obs-password");
  const obsStatusDot = document.getElementById("obs-status-dot");
  const obsStatusText = document.getElementById("obs-status-text");

  // Saweria form
  const saweriaForm = document.getElementById("saweria-form");
  const saweriaKey = document.getElementById("saweria-key");
  const saweriaStatusDot = document.getElementById("saweria-status-dot");
  const saweriaStatusText = document.getElementById("saweria-status-text");

  // Add form
  const addForm = document.getElementById("add-btn-form");
  const btnType = document.getElementById("btn-type");
  const btnIcon = document.getElementById("btn-icon");
  const btnColor = document.getElementById("btn-color");
  const btnLabel = document.getElementById("btn-label");
  const btnScene = document.getElementById("btn-scene");
  const btnSceneCustom = document.getElementById("btn-scene-custom");
  const btnMediaUrl = document.getElementById("btn-media-url");
  const btnDuration = document.getElementById("btn-duration");
  const btnPosition = document.getElementById("btn-position");
  const btnChromaKey = document.getElementById("btn-chroma-key");
  const btnScale = document.getElementById("btn-scale");
  const btnScaleLabel = document.getElementById("btn-scale-label");
  const btnCustomPositionFields = document.getElementById("btn-custom-position-fields");
  const btnCustomX = document.getElementById("btn-custom-x");
  const btnCustomXLabel = document.getElementById("btn-custom-x-label");
  const btnCustomY = document.getElementById("btn-custom-y");
  const btnCustomYLabel = document.getElementById("btn-custom-y-label");
  const btnVisualPositionTrigger = document.getElementById("btn-visual-position-trigger");
  const btnSoundUrl = document.getElementById("btn-sound-url");
  const btnVolume = document.getElementById("btn-volume");
  const btnVolumeLabel = document.getElementById("btn-volume-label");
  const sceneFields = document.getElementById("scene-fields");
  const mediaFields = document.getElementById("media-fields");
  const soundFields = document.getElementById("sound-fields");
  const formSubmitBtn = document.getElementById("form-submit-btn");

  // Edit modal
  const editModal = document.getElementById("edit-modal");
  const editClose = document.getElementById("edit-close");
  const editForm = document.getElementById("edit-btn-form");
  const editId = document.getElementById("edit-id");
  const editType = document.getElementById("edit-type");
  const editIcon = document.getElementById("edit-icon");
  const editColor = document.getElementById("edit-color");
  const editLabel = document.getElementById("edit-label");
  const editScene = document.getElementById("edit-scene");
  const editMediaUrl = document.getElementById("edit-media-url");
  const editDuration = document.getElementById("edit-duration");
  const editPosition = document.getElementById("edit-position");
  const editChromaKey = document.getElementById("edit-chroma-key");
  const editScale = document.getElementById("edit-scale");
  const editScaleLabel = document.getElementById("edit-scale-label");
  const editCustomPositionFields = document.getElementById("edit-custom-position-fields");
  const editCustomX = document.getElementById("edit-custom-x");
  const editCustomXLabel = document.getElementById("edit-custom-x-label");
  const editCustomY = document.getElementById("edit-custom-y");
  const editCustomYLabel = document.getElementById("edit-custom-y-label");
  const editVisualPositionTrigger = document.getElementById("edit-visual-position-trigger");
  const editSoundUrl = document.getElementById("edit-sound-url");
  const editVolume = document.getElementById("edit-volume");
  const editVolumeLabel = document.getElementById("edit-volume-label");
  const editSceneFields = document.getElementById("edit-scene-fields");
  const editMediaFields = document.getElementById("edit-media-fields");
  const editSoundFields = document.getElementById("edit-sound-fields");

  // Visual Positioning Modal (Popup)
  const positionModal = document.getElementById("position-modal");
  const positionClose = document.getElementById("position-close");
  const positionScaleSlider = document.getElementById("position-scale-slider");
  const positionScaleLabel = document.getElementById("position-scale-label");
  const previewCanvas = document.getElementById("preview-canvas");
  const previewBox = document.getElementById("preview-box");
  const positionSave = document.getElementById("position-save");

  // Upload
  const uploadZone = document.getElementById("upload-zone");
  const fileInput = document.getElementById("file-input");
  const uploadProgress = document.getElementById("upload-progress");
  const progressFill = document.getElementById("progress-fill");
  const progressText = document.getElementById("progress-text");
  const mediaList = document.getElementById("media-list");
  const manageList = document.getElementById("manage-list");

  // ── Auth Flow ───────────────────────────────────
  let authMode = "login"; // 'login' or 'register'

  // Toggle Login / Register UI Mode
  authSwitchLink.addEventListener("click", () => {
    loginError.classList.add("hidden");
    loginUsernameInput.value = "";
    loginPasswordInput.value = "";

    if (authMode === "login") {
      authMode = "register";
      authTitle.textContent = "📝 Create Account";
      authDesc.textContent = "Sign up for a new Stream Deck account";
      authSubmitBtn.textContent = "Register";
      authSwitchText.textContent = "Already have an account?";
      authSwitchLink.textContent = "Login";
    } else {
      authMode = "login";
      authTitle.textContent = "🔐 Stream Deck Login";
      authDesc.textContent = "Enter your username and password";
      authSubmitBtn.textContent = "Login";
      authSwitchText.textContent = "Don't have an account?";
      authSwitchLink.textContent = "Register";
    }
    loginUsernameInput.focus();
  });

  async function checkAuth() {
    const token = localStorage.getItem("deck-jwt-token");
    if (token) {
      // Try to check if token or accessKey works
      try {
        const res = await fetch("/api/settings", {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });
        if (res.ok) {
          showApp();
          return;
        }
      } catch (e) {
        // Fetch failed
      }
    }
    
    // Otherwise check if registration is needed
    try {
      const res = await fetch("/api/auth-check");
      const data = await res.json();
      if (!data.needsKey) {
        // No accounts exist, switch to register mode automatically
        authMode = "login";
        authSwitchLink.click();
      }
    } catch (e) {}

    showLogin();
  }

  function showLogin() {
    loginScreen.classList.remove("hidden");
    mainApp.classList.add("hidden");
    loginUsernameInput.focus();
  }

  function showApp() {
    loginScreen.classList.add("hidden");
    mainApp.classList.remove("hidden");
    loadButtons();
    connect();
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value.trim();
    if (!username || !password) return;

    loginError.classList.add("hidden");
    authSubmitBtn.disabled = true;

    try {
      if (authMode === "login") {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        authSubmitBtn.disabled = false;
        
        if (res.ok && data.ok) {
          accessKey = data.accessKey;
          localStorage.setItem("deck-access-key", data.accessKey);
          localStorage.setItem("deck-jwt-token", data.token);
          showApp();
        } else {
          loginError.textContent = data.error || "Invalid username or password";
          loginError.classList.remove("hidden");
        }
      } else {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        authSubmitBtn.disabled = false;

        if (res.ok && data.ok) {
          toast("Account registered! Please log in.", "success");
          authSwitchLink.click(); // Switch back to login mode
          loginUsernameInput.value = username; // Pre-fill username for convenience
          loginPasswordInput.focus();
        } else {
          loginError.textContent = data.error || "Registration failed";
          loginError.classList.remove("hidden");
        }
      }
    } catch {
      authSubmitBtn.disabled = false;
      loginError.textContent = "Connection error";
      loginError.classList.remove("hidden");
    }
  });

  // ── API helper with auth ────────────────────────
  async function api(method, endpoint, body = null) {
    const token = localStorage.getItem("deck-jwt-token");
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": token ? `Bearer ${token}` : "",
        "X-Access-Key": accessKey,
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API}${endpoint}`, opts);
    if (res.status === 401) {
      // Token or Key invalid/changed — force re-login
      localStorage.removeItem("deck-jwt-token");
      localStorage.removeItem("deck-access-key");
      accessKey = "";
      showLogin();
      throw new Error("Unauthorized");
    }
    return res.json();
  }

  // ── WebSocket ───────────────────────────────────
  function connect() {
    ws = new WebSocket(WS_BASE);

    ws.onopen = () => {
      setStatus(true);
      ws.send(
        JSON.stringify({ type: "register", client: "deck", key: accessKey }),
      );
    };

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.type === "auth-failed") {
        localStorage.removeItem("deck-access-key");
        accessKey = "";
        showLogin();
        return;
      }
      if (msg.type === "scene-active") {
        activeScene = msg.scene;
        updateActiveStates();
      }
      if (msg.type === "config-updated") {
        loadButtons();
      }
      if (msg.type === "obs-status") {
        setOBSStatus(msg.connected);
      }
      if (msg.type === "saweria-status") {
        setSaweriaStatus(msg.connected);
      }
      if (msg.type === "saweria-donation") {
        showDonationToast(msg);
      }
    };

    ws.onclose = () => {
      setStatus(false);
      setTimeout(connect, RECONNECT_INTERVAL);
    };
    ws.onerror = () => ws.close();
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function setStatus(c) {
    statusDot.className = `status-dot ${c ? "connected" : "disconnected"}`;
    statusText.textContent = c ? "Connected" : "Disconnected";
  }

  function setOBSStatus(c) {
    obsConnected = c;
    obsDot.className = `status-dot ${c ? "connected" : "disconnected"}`;
    obsDot.title = c ? "OBS Connected" : "OBS Disconnected";
    obsStatusDot.className = `status-dot ${c ? "connected" : "disconnected"}`;
    obsStatusText.textContent = c ? "Connected to OBS" : "Disconnected";
  }

  function setSaweriaStatus(c) {
    saweriaStatusDot.className = `status-dot ${c ? "connected" : "disconnected"}`;
    saweriaStatusText.textContent = c ? "Connected to Saweria" : "Disconnected";
  }

  function showDonationToast(d) {
    toast(
      `💰 ${d.donator}: Rp${Number(d.amount).toLocaleString("id-ID")}`,
      "success",
    );
  }

  // ── Load data ───────────────────────────────────
  async function loadButtons() {
    try {
      const data = await api("GET", "/api/buttons");
      buttons = data.buttons || [];
      renderButtons();
      renderManageList();
    } catch {}
  }

  async function loadMedia() {
    try {
      const data = await api("GET", "/api/media");
      mediaFiles = data.files || [];
      renderMediaList();
      populateMediaSelects();
    } catch {}
  }

  async function loadSettings() {
    try {
      const data = await api("GET", "/api/settings");
      if (data.obs) {
        obsHost.value = data.obs.host || "localhost";
        obsPort.value = data.obs.port || 4455;
        obsPassword.value = data.obs.password || "";
      }
      settingAccessKey.value = data.accessKey || "";
      saweriaKey.value = data.saweria?.streamKey || "";
    } catch {}
  }

  async function loadOBSScenes() {
    try {
      const data = await api("GET", "/api/obs-scenes");
      const scenes = data.scenes || [];
      btnScene.innerHTML = '<option value="">Select a scene...</option>';
      scenes.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        btnScene.appendChild(opt);
      });
    } catch {}
  }

  // ── Render buttons ──────────────────────────────
  function renderButtons() {
    grid.innerHTML = "";
    buttons.forEach((btn) => {
      const el = document.createElement("button");
      el.className = "deck-btn";
      el.dataset.id = btn.id;
      el.dataset.type = btn.type;
      el.style.setProperty("--btn-color", btn.color || "#6366f1");

      const glow = document.createElement("div");
      glow.className = "glow";
      glow.style.background = `radial-gradient(circle at 50% 50%, ${btn.color || "#6366f1"}15, transparent 70%)`;
      el.appendChild(glow);

      const icon = document.createElement("span");
      icon.className = "btn-icon";
      icon.textContent = btn.icon || "⬜";
      el.appendChild(icon);

      const label = document.createElement("span");
      label.className = "btn-label";
      label.textContent = btn.label;
      el.appendChild(label);

      el.addEventListener("click", () => handlePress(btn));
      el.addEventListener("pointerdown", (e) => createRipple(el, e, btn.color));
      grid.appendChild(el);
    });
    updateActiveStates();
  }

  function handlePress(btn) {
    switch (btn.type) {
      case "scene":
        activeScene = btn.action.scene;
        send({ type: "switch-scene", scene: btn.action.scene });
        updateActiveStates();
        break;
      case "media":
        send({
          type: "show-media",
          url: btn.action.url,
          duration: btn.action.duration || 5000,
          position: btn.action.position || "center",
          chromaKey: btn.action.chromaKey,
          scale: btn.action.scale || 100,
          customX: btn.action.customX || 50,
          customY: btn.action.customY || 50,
        });
        break;
      case "sound":
        send({
          type: "play-sound",
          url: btn.action.url,
          volume: btn.action.volume ?? 0.8,
        });
        break;
      case "clear":
        send({ type: "clear-media" });
        break;
    }
  }

  function updateActiveStates() {
    grid.querySelectorAll(".deck-btn").forEach((el) => {
      const btn = buttons.find((b) => b.id === el.dataset.id);
      if (btn && btn.type === "scene")
        el.classList.toggle("active", btn.action.scene === activeScene);
    });
  }

  function createRipple(el, e, color) {
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    ripple.style.background = `${color || "#6366f1"}30`;
    el.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  }

  // ── Settings panel ──────────────────────────────
  function openSettings() {
    settingsOverlay.classList.remove("hidden");
    loadMedia();
    loadSettings();
    loadOBSScenes();
    renderManageList();
  }

  function closeSettings() {
    settingsOverlay.classList.add("hidden");
  }

  settingsToggle.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  // ── Full Remote ─────────────────────────────────
  remoteBtn.addEventListener("click", async () => {
    try {
      const creds = await api("GET", "/api/obs-creds");
      if (creds && creds.host) {
        // Use the new secure proxy endpoint so it works over HTTPS (Cloudflare Tunnels)
        const pwd = creds.password || "";
        const proto = location.protocol === "https:" ? "wss://" : "ws://";

        // Point obs-web to our same-origin proxy with access key authentication
        let url = `/obs-web/#${proto}${location.host}/api/obs-proxy?key=${accessKey}`;
        if (pwd) url += `#${pwd}`;

        window.open(url, "_blank");
      } else {
        toast("OBS connection is not configured", "error");
      }
    } catch {
      toast("Failed to get OBS credentials", "error");
    }
  });

  accessKeyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newKey = settingAccessKey.value.trim();
    try {
      await api("PUT", "/api/settings", { accessKey: newKey });
      accessKey = newKey;
      localStorage.setItem("deck-access-key", newKey);
      toast(
        newKey
          ? "Access key updated!"
          : "Access key removed — deck is now open",
        "success",
      );
    } catch {
      toast("Failed to save key", "error");
    }
  });

  // ── OBS form ────────────────────────────────────
  obsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("PUT", "/api/settings", {
        obs: {
          host: obsHost.value.trim(),
          port: parseInt(obsPort.value) || 4455,
          password: obsPassword.value,
        },
      });
      toast("OBS settings saved, connecting...", "success");
    } catch {
      toast("Failed to save OBS settings", "error");
    }
  });

  // ── Saweria form ────────────────────────────────
  saweriaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("PUT", "/api/settings", {
        saweria: { streamKey: saweriaKey.value.trim() },
      });
      toast("Saweria connecting...", "success");
    } catch {
      toast("Failed to save Saweria settings", "error");
    }
  });

  // ── Type field toggling ─────────────────────────
  function toggleTypeFields(type, sceneEl, mediaEl, soundEl) {
    sceneEl.classList.toggle("hidden", type !== "scene");
    mediaEl.classList.toggle("hidden", type !== "media");
    soundEl.classList.toggle("hidden", type !== "sound");
  }
  btnType.addEventListener("change", () =>
    toggleTypeFields(btnType.value, sceneFields, mediaFields, soundFields),
  );
  editType.addEventListener("change", () =>
    toggleTypeFields(
      editType.value,
      editSceneFields,
      editMediaFields,
      editSoundFields,
    ),
  );

  // ── Volume sliders ──────────────────────────────
  btnVolume.addEventListener("input", () => {
    btnVolumeLabel.textContent = `${btnVolume.value}%`;
  });
  editVolume.addEventListener("input", () => {
    editVolumeLabel.textContent = `${editVolume.value}%`;
  });

  // ── Custom Position Fields Toggling & Sliders ───
  function toggleCustomFields(positionValue, fieldsContainer) {
    if (positionValue === "custom") {
      fieldsContainer.classList.remove("hidden");
    } else {
      fieldsContainer.classList.add("hidden");
    }
  }

  btnPosition.addEventListener("change", () => {
    toggleCustomFields(btnPosition.value, btnCustomPositionFields);
  });
  editPosition.addEventListener("change", () => {
    toggleCustomFields(editPosition.value, editCustomPositionFields);
  });

  btnScale.addEventListener("input", () => {
    btnScaleLabel.textContent = `${btnScale.value}%`;
  });
  btnCustomX.addEventListener("input", () => {
    btnCustomXLabel.textContent = `${btnCustomX.value}%`;
  });
  btnCustomY.addEventListener("input", () => {
    btnCustomYLabel.textContent = `${btnCustomY.value}%`;
  });

  editScale.addEventListener("input", () => {
    editScaleLabel.textContent = `${editScale.value}%`;
  });
  editCustomX.addEventListener("input", () => {
    editCustomXLabel.textContent = `${editCustomX.value}%`;
  });
  editCustomY.addEventListener("input", () => {
    editCustomYLabel.textContent = `${editCustomY.value}%`;
  });

  // ── Visual Positioning Modal (Popup Tool) ───────
  let activePositionSource = null; // 'add' or 'edit'
  let previewBoxX = 50;
  let previewBoxY = 50;
  let isDragging = false;

  function updatePreviewBox(x, y, scale) {
    previewBoxX = x;
    previewBoxY = y;
    previewBox.style.left = `${x}%`;
    previewBox.style.top = `${y}%`;
    previewBox.style.transform = `translate(-50%, -50%) scale(${scale / 100})`;
  }

  function openPositionModal(source) {
    activePositionSource = source;
    positionModal.classList.remove("hidden");

    let currentScale = 100;
    let currentX = 50;
    let currentY = 50;

    if (source === "add") {
      currentScale = parseInt(btnScale.value) || 100;
      currentX = parseInt(btnCustomX.value) || 50;
      currentY = parseInt(btnCustomY.value) || 50;
    } else if (source === "edit") {
      currentScale = parseInt(editScale.value) || 100;
      currentX = parseInt(editCustomX.value) || 50;
      currentY = parseInt(editCustomY.value) || 50;
    }

    positionScaleSlider.value = currentScale;
    positionScaleLabel.textContent = `Size: ${currentScale}%`;

    updatePreviewBox(currentX, currentY, currentScale);
  }

  positionScaleSlider.addEventListener("input", () => {
    const scale = positionScaleSlider.value;
    positionScaleLabel.textContent = `Size: ${scale}%`;
    updatePreviewBox(previewBoxX, previewBoxY, scale);
  });

  function handlePointerMove(e) {
    const rect = previewCanvas.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;

    x = Math.max(0, Math.min(100, Math.round(x)));
    y = Math.max(0, Math.min(100, Math.round(y)));

    const scale = parseInt(positionScaleSlider.value) || 100;
    updatePreviewBox(x, y, scale);
  }

  previewCanvas.addEventListener("pointerdown", (e) => {
    isDragging = true;
    previewCanvas.setPointerCapture(e.pointerId);
    handlePointerMove(e);
  });

  previewCanvas.addEventListener("pointermove", (e) => {
    if (isDragging) {
      handlePointerMove(e);
    }
  });

  previewCanvas.addEventListener("pointerup", (e) => {
    if (isDragging) {
      isDragging = false;
      previewCanvas.releasePointerCapture(e.pointerId);
    }
  });

  positionSave.addEventListener("click", () => {
    const scale = parseInt(positionScaleSlider.value) || 100;
    const x = previewBoxX;
    const y = previewBoxY;

    if (activePositionSource === "add") {
      btnScale.value = scale;
      btnScaleLabel.textContent = `${scale}%`;
      btnCustomX.value = x;
      btnCustomXLabel.textContent = `${x}%`;
      btnCustomY.value = y;
      btnCustomYLabel.textContent = `${y}%`;
      btnPosition.value = "custom";
      toggleCustomFields("custom", btnCustomPositionFields);
    } else if (activePositionSource === "edit") {
      editScale.value = scale;
      editScaleLabel.textContent = `${scale}%`;
      editCustomX.value = x;
      editCustomXLabel.textContent = `${x}%`;
      editCustomY.value = y;
      editCustomYLabel.textContent = `${y}%`;
      editPosition.value = "custom";
      toggleCustomFields("custom", editCustomPositionFields);
    }

    positionModal.classList.add("hidden");
    toast("Position and size applied!", "success");
  });

  positionClose.addEventListener("click", () => {
    positionModal.classList.add("hidden");
  });

  positionModal.addEventListener("click", (e) => {
    if (e.target === positionModal) {
      positionModal.classList.add("hidden");
    }
  });

  btnVisualPositionTrigger.addEventListener("click", () => openPositionModal("add"));
  editVisualPositionTrigger.addEventListener("click", () => openPositionModal("edit"));

  // ── Add button form ─────────────────────────────
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = btnType.value;
    const id = `${type}-${Date.now()}`;
    const action = {};

    if (type === "scene") {
      const scene = btnScene.value || btnSceneCustom.value.trim();
      if (!scene) {
        toast("Enter scene name", "error");
        return;
      }
      action.scene = scene;
    } else if (type === "media") {
      if (!btnMediaUrl.value) {
        toast("Select a media file", "error");
        return;
      }
      action.url = btnMediaUrl.value;
      action.duration = parseInt(btnDuration.value) || 5000;
      action.position = btnPosition.value;
      action.chromaKey = btnChromaKey.checked;
      action.scale = parseInt(btnScale.value) || 100;
      action.customX = parseInt(btnCustomX.value) || 50;
      action.customY = parseInt(btnCustomY.value) || 50;
    } else if (type === "sound") {
      if (!btnSoundUrl.value) {
        toast("Select a sound file", "error");
        return;
      }
      action.url = btnSoundUrl.value;
      action.volume = parseInt(btnVolume.value) / 100;
    }

    const defaultIcons = {
      scene: "🖥️",
      media: "🎬",
      sound: "🔊",
      clear: "🧹"
    };
    const finalIcon = btnIcon.value.trim() || defaultIcons[type] || "⬜";

    try {
      formSubmitBtn.disabled = true;
      formSubmitBtn.textContent = "Adding...";
      await api("POST", "/api/buttons", {
        id,
        label: btnLabel.value.trim(),
        icon: finalIcon,
        type,
        color: btnColor.value,
        action,
      });
      toast("Button added!", "success");
      addForm.reset();
      btnColor.value = "#6366f1";
      btnVolume.value = 80;
      btnVolumeLabel.textContent = "80%";
      btnScale.value = 100;
      btnScaleLabel.textContent = "100%";
      btnCustomX.value = 50;
      btnCustomXLabel.textContent = "50%";
      btnCustomY.value = 50;
      btnCustomYLabel.textContent = "50%";
      toggleCustomFields("center", btnCustomPositionFields);
      toggleTypeFields("scene", sceneFields, mediaFields, soundFields);
      await loadButtons();
    } catch {
      toast("Failed to add button", "error");
    } finally {
      formSubmitBtn.disabled = false;
      formSubmitBtn.textContent = "Add Button";
    }
  });

  // ── Edit button ─────────────────────────────────
  function openEditModal(btn) {
    editId.value = btn.id;
    editType.value = btn.type;
    editIcon.value = btn.icon || "";
    editColor.value = btn.color || "#6366f1";
    editLabel.value = btn.label;
    if (btn.type === "scene") editScene.value = btn.action?.scene || "";
    else if (btn.type === "media") {
      editMediaUrl.value = btn.action?.url || "";
      editDuration.value = btn.action?.duration || 5000;
      editPosition.value = btn.action?.position || "center";
      editChromaKey.checked = !!btn.action?.chromaKey;
      
      const sc = btn.action?.scale || 100;
      editScale.value = sc;
      editScaleLabel.textContent = `${sc}%`;

      const cx = btn.action?.customX || 50;
      editCustomX.value = cx;
      editCustomXLabel.textContent = `${cx}%`;

      const cy = btn.action?.customY || 50;
      editCustomY.value = cy;
      editCustomYLabel.textContent = `${cy}%`;

      toggleCustomFields(editPosition.value, editCustomPositionFields);
    } else if (btn.type === "sound") {
      editSoundUrl.value = btn.action?.url || "";
      const v = Math.round((btn.action?.volume ?? 0.8) * 100);
      editVolume.value = v;
      editVolumeLabel.textContent = `${v}%`;
    }
    toggleTypeFields(
      btn.type,
      editSceneFields,
      editMediaFields,
      editSoundFields,
    );
    populateMediaSelects();
    if (btn.type === "media" && btn.action?.url)
      editMediaUrl.value = btn.action.url;
    if (btn.type === "sound" && btn.action?.url)
      editSoundUrl.value = btn.action.url;
    editModal.classList.remove("hidden");
  }

  editClose.addEventListener("click", () => editModal.classList.add("hidden"));
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) editModal.classList.add("hidden");
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = editType.value;
    const action = {};
    if (type === "scene") action.scene = editScene.value.trim();
    else if (type === "media") {
      action.url = editMediaUrl.value;
      action.duration = parseInt(editDuration.value) || 5000;
      action.position = editPosition.value;
      action.chromaKey = editChromaKey.checked;
      action.scale = parseInt(editScale.value) || 100;
      action.customX = parseInt(editCustomX.value) || 50;
      action.customY = parseInt(editCustomY.value) || 50;
    } else if (type === "sound") {
      action.url = editSoundUrl.value;
      action.volume = parseInt(editVolume.value) / 100;
    }

    const defaultIcons = {
      scene: "🖥️",
      media: "🎬",
      sound: "🔊",
      clear: "🧹"
    };
    const finalIcon = editIcon.value.trim() || defaultIcons[type] || "⬜";

    try {
      await api("PUT", `/api/buttons/${encodeURIComponent(editId.value)}`, {
        label: editLabel.value.trim(),
        icon: finalIcon,
        type,
        color: editColor.value,
        action,
      });
      toast("Button updated!", "success");
      editModal.classList.add("hidden");
      await loadButtons();
    } catch {
      toast("Failed to update", "error");
    }
  });

  async function deleteButton(id) {
    if (!confirm("Delete this button?")) return;
    try {
      await api("DELETE", `/api/buttons/${encodeURIComponent(id)}`);
      toast("Deleted", "success");
      await loadButtons();
    } catch {
      toast("Failed to delete", "error");
    }
  }

  // ── Manage list ─────────────────────────────────
  function renderManageList() {
    manageList.innerHTML = "";
    buttons.forEach((btn) => {
      const item = document.createElement("div");
      item.className = "manage-item";
      item.innerHTML = `
        <span class="mi-icon">${btn.icon || "⬜"}</span>
        <div class="mi-info"><div class="mi-label">${btn.label}</div><div class="mi-type">${btn.type}</div></div>
        <div class="mi-actions">
          <button class="small-btn edit-btn" title="Edit">✏️</button>
          <button class="small-btn danger delete-btn" title="Delete">🗑️</button>
        </div>
      `;
      item
        .querySelector(".edit-btn")
        .addEventListener("click", () => openEditModal(btn));
      item
        .querySelector(".delete-btn")
        .addEventListener("click", () => deleteButton(btn.id));
      manageList.appendChild(item);
    });
    if (!buttons.length)
      manageList.innerHTML =
        '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:16px">No buttons yet</p>';
  }

  // ── Upload ──────────────────────────────────────
  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragover");
  });
  uploadZone.addEventListener("dragleave", () =>
    uploadZone.classList.remove("dragover"),
  );
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) uploadFiles(fileInput.files);
    fileInput.value = "";
  });

  async function uploadFiles(fileList) {
    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++)
      formData.append("file", fileList[i], fileList[i].name);
    uploadProgress.classList.remove("hidden");
    progressFill.style.width = "30%";
    progressText.textContent = `Uploading ${fileList.length} file(s)...`;
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        headers: { "X-Access-Key": accessKey },
      });
      const data = await res.json();
      if (data.uploaded?.length > 0) {
        progressFill.style.width = "100%";
        progressText.textContent = `✅ ${data.uploaded.length} file(s)`;
        toast(`${data.uploaded.length} file(s) uploaded!`, "success");
        await loadMedia();
      } else {
        progressText.textContent = "❌ No valid files";
        toast(data.error || "Failed", "error");
      }
    } catch {
      progressText.textContent = "❌ Failed";
      toast("Upload error", "error");
    }
    setTimeout(() => {
      uploadProgress.classList.add("hidden");
      progressFill.style.width = "0%";
    }, 2000);
  }

  // ── Media list (paginated + lazy) ───────────────
  const MEDIA_PAGE_SIZE = 12;
  let mediaPage = 1;

  function renderMediaList() {
    mediaList.innerHTML = "";
    mediaPage = 1;
    renderMediaPage();
  }

  function renderMediaPage() {
    const visible = mediaFiles.slice(0, mediaPage * MEDIA_PAGE_SIZE);
    const oldMore = mediaList.querySelector(".media-show-more");
    if (oldMore) oldMore.remove();
    const startIdx = (mediaPage - 1) * MEDIA_PAGE_SIZE;
    visible.slice(startIdx).forEach((file) => {
      const item = document.createElement("div");
      item.className =
        "media-item" + (file.type === "audio" ? " audio-item" : "");
      if (file.type === "audio") {
        item.innerHTML = "🔊";
      } else {
        const isVideo = file.filename.match(/\.(mp4|webm)$/i);
        if (isVideo) {
          item.innerHTML = `<video src="${file.url}" muted preload="metadata" playsinline></video>`;
          const vid = item.querySelector("video");
          item.addEventListener("mouseenter", () => vid.play().catch(() => {}));
          item.addEventListener("mouseleave", () => {
            vid.pause();
            vid.currentTime = 0;
          });
        } else {
          item.innerHTML = `<img data-src="${file.url}" alt="${file.filename}" class="lazy-img">`;
        }
      }
      item.innerHTML += `<span class="media-name">${file.filename}</span>`;
      mediaList.appendChild(item);
    });
    lazyLoadImages();
    if (visible.length < mediaFiles.length) {
      const more = document.createElement("div");
      more.className = "media-show-more";
      more.innerHTML = `<button class="small-btn" style="width:100%;padding:8px;font-size:0.75rem">Show more (${mediaFiles.length - visible.length} left)</button>`;
      more.querySelector("button").addEventListener("click", () => {
        mediaPage++;
        renderMediaPage();
      });
      mediaList.appendChild(more);
    }
  }

  function lazyLoadImages() {
    const imgs = mediaList.querySelectorAll("img.lazy-img[data-src]");
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.src = e.target.dataset.src;
              e.target.removeAttribute("data-src");
              e.target.classList.remove("lazy-img");
              io.unobserve(e.target);
            }
          });
        },
        { root: mediaList.closest(".settings-panel"), rootMargin: "100px" },
      );
      imgs.forEach((img) => io.observe(img));
    } else {
      imgs.forEach((img) => {
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
      });
    }
  }

  function populateMediaSelects() {
    const visual = mediaFiles.filter((f) => f.type !== "audio");
    const audio = mediaFiles.filter((f) => f.type === "audio");
    [btnMediaUrl, editMediaUrl].forEach((sel) => {
      const c = sel.value;
      sel.innerHTML = '<option value="">Select uploaded media...</option>';
      visual.forEach((f) => {
        const o = document.createElement("option");
        o.value = f.url;
        o.textContent = f.filename;
        sel.appendChild(o);
      });
      sel.value = c;
    });
    [btnSoundUrl, editSoundUrl].forEach((sel) => {
      const c = sel.value;
      sel.innerHTML = '<option value="">Select uploaded audio...</option>';
      audio.forEach((f) => {
        const o = document.createElement("option");
        o.value = f.url;
        o.textContent = f.filename;
        sel.appendChild(o);
      });
      sel.value = c;
    });
  }

  // ── Toast ───────────────────────────────────────
  function toast(msg, type = "success") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ── Init ────────────────────────────────────────
  checkAuth();
})();
