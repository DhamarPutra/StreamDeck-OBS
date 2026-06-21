const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { pool, initDB } = require("./db");

// ── Config ──────────────────────────────────────────────
const WS_PORT = 9069;
const DECK_PORT = 8069;
const OVERLAY_PORT = 8070;
const ROOT = path.resolve(__dirname, "..");
const MEDIA_DIR = path.join(ROOT, "media");
const MAX_UPLOAD = 50 * 1024 * 1024;
const JWT_SECRET = process.env.JWT_SECRET || "fujiwara_streamdeck_secret_jwt_token_key_998811";

// ── MIME types ──────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const MEDIA_EXTS = [
  ".gif",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".webm",
  ".mp4",
  ".svg",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
];
const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".m4a"];

// ── Helpers ─────────────────────────────────────────────
function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Key, Authorization",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(req, body) {
  const ct = req.headers["content-type"] || "";
  const bm = ct.match(/boundary=(.+)/);
  if (!bm) return null;
  const boundary = bm[1];
  const bb = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = body.indexOf(bb) + bb.length;
  while (true) {
    const next = body.indexOf(bb, start);
    if (next === -1) break;
    const part = body.slice(start, next);
    const he = part.indexOf("\r\n\r\n");
    if (he === -1) {
      start = next + bb.length;
      continue;
    }
    const hs = part.slice(0, he).toString();
    const fd = part.slice(he + 4, part.length - 2);
    const nm = hs.match(/name="([^"]+)"/);
    const fm = hs.match(/filename="([^"]+)"/);
    parts.push({
      name: nm ? nm[1] : "",
      filename: fm ? fm[1] : null,
      data: fd,
    });
    start = next + bb.length;
  }
  return parts;
}

// ── Multi-Tenant Token Authentication Middleware ───────
async function authenticateUser(req) {
  // 1. Try JWT Bearer token
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.userId) {
        req.userId = decoded.userId;
        return true;
      }
    } catch (e) {
      // Invalid token
    }
  }

  // 2. Try Access Key Header
  const headerKey = req.headers["x-access-key"];
  if (headerKey) {
    try {
      const result = await pool.query("SELECT id FROM users WHERE access_key = $1", [headerKey]);
      if (result.rows.length > 0) {
        req.userId = result.rows[0].id;
        return true;
      }
    } catch (e) {
      // DB error
    }
  }

  // 3. Try URL key query param (for WebSocket or images loading)
  const parsedUrl = new URL(req.url, "http://localhost");
  const queryKey = parsedUrl.searchParams.get("key");
  if (queryKey) {
    try {
      const result = await pool.query("SELECT id FROM users WHERE access_key = $1", [queryKey]);
      if (result.rows.length > 0) {
        req.userId = result.rows[0].id;
        return true;
      }
    } catch (e) {
      // DB error
    }
  }

  return false;
}

// ── Multiplexed OBS Connections ──────────────────────────
const userOBSConnections = {};
const userOBSStatus = {};
const userOBSRetries = {};

async function connectUserOBS(userId) {
  // If already connected, do nothing
  if (userOBSConnections[userId] && userOBSStatus[userId]) {
    return userOBSConnections[userId];
  }

  // Fetch settings from DB
  const result = await pool.query("SELECT * FROM settings WHERE user_id = $1", [userId]);
  if (result.rows.length === 0) return null;

  const { obs_host, obs_port, obs_password } = result.rows[0];
  if (!obs_host || !obs_port) return null;

  try {
    const OBSWebSocket = require("obs-websocket-js").default || require("obs-websocket-js");
    const obs = new OBSWebSocket();
    const url = `ws://${obs_host}:${obs_port}`;
    console.log(`[OBS - User ${userId}] Connecting to ${url}...`);

    if (obs_password) {
      await obs.connect(url, obs_password);
    } else {
      await obs.connect(url);
    }

    userOBSConnections[userId] = obs;
    userOBSStatus[userId] = true;
    console.log(`[OBS - User ${userId}] ✅ Connected to OBS Studio`);
    broadcastToDecks(userId, { type: "obs-status", connected: true });

    obs.on("ConnectionClosed", () => {
      console.log(`[OBS - User ${userId}] Connection closed`);
      userOBSStatus[userId] = false;
      broadcastToDecks(userId, { type: "obs-status", connected: false });
      scheduleUserOBSReconnect(userId);
    });

    obs.on("ConnectionError", (err) => {
      console.log(`[OBS - User ${userId}] Error:`, err.message);
    });

    return obs;
  } catch (err) {
    console.log(`[OBS - User ${userId}] ❌ Connection failed: ${err.message}`);
    userOBSStatus[userId] = false;
    broadcastToDecks(userId, { type: "obs-status", connected: false });
    scheduleUserOBSReconnect(userId);
    return null;
  }
}

function scheduleUserOBSReconnect(userId) {
  if (userOBSRetries[userId]) clearTimeout(userOBSRetries[userId]);
  userOBSRetries[userId] = setTimeout(() => {
    connectUserOBS(userId).catch(() => {});
  }, 5000);
}

async function switchUserOBSScene(userId, sceneName) {
  const obs = userOBSConnections[userId];
  if (!obs || !userOBSStatus[userId]) {
    return false;
  }
  try {
    await obs.call("SetCurrentProgramScene", { sceneName });
    console.log(`[OBS - User ${userId}] ✅ Scene switched: ${sceneName}`);
    return true;
  } catch (err) {
    console.log(`[OBS - User ${userId}] ❌ Scene switch failed: ${err.message}`);
    return false;
  }
}

// ── Multiplexed Saweria Connections ──────────────────────
const userSaweriaConnections = {};
const userSaweriaRetries = {};

async function connectUserSaweria(userId) {
  if (userSaweriaConnections[userId]) {
    try {
      userSaweriaConnections[userId].close();
    } catch {}
    delete userSaweriaConnections[userId];
  }

  // Fetch settings from DB
  const result = await pool.query("SELECT saweria_stream_key FROM settings WHERE user_id = $1", [userId]);
  if (result.rows.length === 0) return;

  const streamKey = result.rows[0].saweria_stream_key;
  if (!streamKey) return;

  const url = `wss://events.saweria.co/stream?channel=${streamKey}`;
  console.log(`[Saweria - User ${userId}] Connecting...`);

  const ws = new WebSocket(url);
  userSaweriaConnections[userId] = ws;

  ws.on("open", () => {
    console.log(`[Saweria - User ${userId}] ✅ Connected`);
    broadcastToDecks(userId, { type: "saweria-status", connected: true });
  });

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === "donation" || data.amount_raw || data.donator) {
        const donation = {
          type: "saweria-donation",
          donator: data.donator || data.emitter_name || "Anonymous",
          amount: data.amount_raw || data.amount || 0,
          message: data.message || "",
          media: data.media || null,
          currency: data.currency || "IDR",
        };

        console.log(`[Saweria - User ${userId}] 💰 ${donation.donator}: Rp${donation.amount.toLocaleString()} - "${donation.message}"`);
        broadcastToOverlays(userId, donation);
        broadcastToDecks(userId, donation);
      }
    } catch (err) {}
  });

  ws.on("close", () => {
    console.log(`[Saweria - User ${userId}] Disconnected`);
    broadcastToDecks(userId, { type: "saweria-status", connected: false });
    scheduleUserSaweriaReconnect(userId);
  });

  ws.on("error", (err) => {
    console.log(`[Saweria - User ${userId}] Error: ${err.message}`);
  });
}

function scheduleUserSaweriaReconnect(userId) {
  if (userSaweriaRetries[userId]) clearTimeout(userSaweriaRetries[userId]);
  userSaweriaRetries[userId] = setTimeout(() => {
    connectUserSaweria(userId).catch(() => {});
  }, 5000);
}

// ── Multi-Tenant WebSocket Routing ───────────────────────
const wss = new WebSocketServer({ port: WS_PORT });
const userClients = {}; // Structure: { [userId]: { deck: Set, overlay: Set } }

function getClientGroup(userId) {
  if (!userClients[userId]) {
    userClients[userId] = { deck: new Set(), overlay: new Set() };
  }
  return userClients[userId];
}

function broadcastToDecks(userId, msg) {
  const data = JSON.stringify(msg);
  const group = getClientGroup(userId);
  group.deck.forEach((c) => {
    if (c.readyState === 1) c.send(data);
  });
}

function broadcastToOverlays(userId, msg) {
  const data = JSON.stringify(msg);
  const group = getClientGroup(userId);
  group.overlay.forEach((c) => {
    if (c.readyState === 1) c.send(data);
  });
}

wss.on("connection", (ws, req) => {
  let authenticatedUser = null;
  let clientType = null;

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "register") {
      clientType = msg.client;

      try {
        const result = await pool.query("SELECT id FROM users WHERE access_key = $1", [msg.key]);
        if (result.rows.length === 0) {
          ws.send(JSON.stringify({ type: "auth-failed" }));
          ws.close();
          return;
        }

        authenticatedUser = result.rows[0].id;
        ws.userId = authenticatedUser;
        ws.accessKey = msg.key;
        const group = getClientGroup(authenticatedUser);
        group[clientType].add(ws);
        console.log(`[WS - User ${authenticatedUser}] Registered ${clientType} client`);

        if (clientType === "deck") {
          ws.send(JSON.stringify({ type: "obs-status", connected: !!userOBSStatus[authenticatedUser] }));
          ws.send(JSON.stringify({
            type: "saweria-status",
            connected: !!(userSaweriaConnections[authenticatedUser] && userSaweriaConnections[authenticatedUser].readyState === 1)
          }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: "auth-failed" }));
        ws.close();
      }
      return;
    }

    // Process actions if client is registered and authenticated
    if (authenticatedUser && clientType === "deck") {
      if (msg.type === "switch-scene") {
        await switchUserOBSScene(authenticatedUser, msg.scene);
      }
      if ((msg.type === "show-media" || msg.type === "play-sound") && msg.url) {
        const separator = msg.url.includes("?") ? "&" : "?";
        msg.url = `${msg.url}${separator}key=${ws.accessKey}`;
      }
      broadcastToOverlays(authenticatedUser, msg);
    }

    if (authenticatedUser && clientType === "overlay") {
      if (msg.type === "switch-scene") {
        await switchUserOBSScene(authenticatedUser, msg.scene);
      }
      broadcastToDecks(authenticatedUser, msg);
    }
  });

  ws.on("close", () => {
    if (authenticatedUser && clientType) {
      const group = getClientGroup(authenticatedUser);
      group[clientType].delete(ws);
      console.log(`[WS - User ${authenticatedUser}] Disconnected ${clientType} client`);
    }
  });
});

// ── API Router ──────────────────────────────────────────
async function handleAPI(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    sendJSON(res, 204, null);
    return true;
  }

  // ── No-Auth Routes: User Auth ──────────────────
  if (method === "POST" && pathname === "/api/register") {
    try {
      const body = await parseBody(req);
      const { username, password } = JSON.parse(body.toString());

      if (!username || !password) {
        sendJSON(res, 400, { error: "Username and password required" });
        return true;
      }

      // Check if username exists
      const existRes = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
      if (existRes.rows.length > 0) {
        sendJSON(res, 409, { error: "Username is already taken" });
        return true;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const accessKey = crypto.randomBytes(32).toString("hex");

      // Insert User
      const userRes = await pool.query(
        "INSERT INTO users (username, password_hash, access_key) VALUES ($1, $2, $3) RETURNING id",
        [username, passwordHash, accessKey]
      );
      const newUserId = userRes.rows[0].id;

      // Insert default settings
      await pool.query("INSERT INTO settings (user_id) VALUES ($1)", [newUserId]);

      sendJSON(res, 201, { ok: true, message: "User registered successfully!" });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/login") {
    try {
      const body = await parseBody(req);
      const { username, password } = JSON.parse(body.toString());

      if (!username || !password) {
        sendJSON(res, 400, { error: "Username and password required" });
        return true;
      }

      const userRes = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
      if (userRes.rows.length === 0) {
        sendJSON(res, 401, { error: "Invalid username or password" });
        return true;
      }

      const user = userRes.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        sendJSON(res, 401, { error: "Invalid username or password" });
        return true;
      }

      // Generate JWT Token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });

      // Proactively establish connection to their OBS/Saweria if not already connected
      connectUserOBS(user.id).catch(() => {});
      connectUserSaweria(user.id).catch(() => {});

      sendJSON(res, 200, {
        ok: true,
        token,
        accessKey: user.access_key,
        username: user.username,
      });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/auth") {
    // Left for legacy/fallback support
    try {
      const body = await parseBody(req);
      const { key } = JSON.parse(body.toString());
      const result = await pool.query("SELECT * FROM users WHERE access_key = $1", [key]);
      if (result.rows.length > 0) {
        sendJSON(res, 200, { ok: true });
      } else {
        sendJSON(res, 401, { ok: false, error: "Invalid access key" });
      }
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
    return true;
  }

  if (method === "GET" && pathname === "/api/auth-check") {
    // With multi-user enabled, check if any users exist.
    try {
      const result = await pool.query("SELECT COUNT(*) FROM users");
      const count = parseInt(result.rows[0].count);
      sendJSON(res, 200, { needsKey: count > 0 });
    } catch (e) {
      sendJSON(res, 200, { needsKey: true });
    }
    return true;
  }

  // ── Authenticated Routes Middleware ────────────
  const isAuthenticated = await authenticateUser(req);
  if (!isAuthenticated) {
    sendJSON(res, 401, { error: "Invalid, expired, or missing session credentials" });
    return true;
  }

  const userId = req.userId;

  // ── Settings API ───────────────────────────────
  if (method === "GET" && pathname === "/api/settings") {
    try {
      const result = await pool.query("SELECT * FROM settings WHERE user_id = $1", [userId]);
      const userRes = await pool.query("SELECT access_key FROM users WHERE id = $1", [userId]);
      const accessKey = userRes.rows[0].access_key;

      if (result.rows.length === 0) {
        sendJSON(res, 200, {
          obs: { host: "localhost", port: 4455, password: "" },
          saweria: { streamKey: "" },
          accessKey,
        });
      } else {
        const row = result.rows[0];
        sendJSON(res, 200, {
          obs: {
            host: row.obs_host || "localhost",
            port: row.obs_port || 4455,
            password: row.obs_password ? "••••••" : "",
          },
          saweria: {
            streamKey: row.saweria_stream_key || "",
          },
          accessKey,
        });
      }
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  if (method === "GET" && pathname === "/api/obs-creds") {
    try {
      const result = await pool.query("SELECT obs_host as host, obs_port as port, obs_password as password FROM settings WHERE user_id = $1", [userId]);
      if (result.rows.length === 0) {
        sendJSON(res, 200, {});
      } else {
        sendJSON(res, 200, result.rows[0]);
      }
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  if (method === "PUT" && pathname === "/api/settings") {
    try {
      const body = await parseBody(req);
      const newSettings = JSON.parse(body.toString());

      // Fetch current settings
      const currRes = await pool.query("SELECT * FROM settings WHERE user_id = $1", [userId]);
      let current = currRes.rows[0];

      if (!current) {
        await pool.query("INSERT INTO settings (user_id) VALUES ($1)", [userId]);
        const refRes = await pool.query("SELECT * FROM settings WHERE user_id = $1", [userId]);
        current = refRes.rows[0];
      }

      let updateOBS = false;
      let updateSaweria = false;

      // Handle OBS changes
      if (newSettings.obs) {
        let pwd = newSettings.obs.password;
        if (pwd === "••••••") {
          pwd = current.obs_password || "";
        }
        await pool.query(
          "UPDATE settings SET obs_host = $1, obs_port = $2, obs_password = $3 WHERE user_id = $4",
          [newSettings.obs.host || "localhost", parseInt(newSettings.obs.port) || 4455, pwd, userId]
        );
        updateOBS = true;
      }

      // Handle Saweria changes
      if (newSettings.saweria) {
        await pool.query(
          "UPDATE settings SET saweria_stream_key = $1 WHERE user_id = $2",
          [newSettings.saweria.streamKey || "", userId]
        );
        updateSaweria = true;
      }

      // Reconnect active streams dynamically
      if (updateOBS) {
        if (userOBSConnections[userId]) {
          try {
            await userOBSConnections[userId].disconnect();
          } catch {}
          delete userOBSConnections[userId];
        }
        userOBSStatus[userId] = false;
        connectUserOBS(userId).catch(() => {});
      }

      if (updateSaweria) {
        connectUserSaweria(userId).catch(() => {});
      }

      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
    return true;
  }

  // ── OBS status and scenes ───────────────────────
  if (method === "GET" && pathname === "/api/obs-status") {
    sendJSON(res, 200, { connected: !!userOBSStatus[userId] });
    return true;
  }

  if (method === "GET" && pathname === "/api/obs-scenes") {
    const obs = await connectUserOBS(userId);
    if (!obs || !userOBSStatus[userId]) {
      sendJSON(res, 200, { scenes: [] });
      return true;
    }
    try {
      const { scenes } = await obs.call("GetSceneList");
      sendJSON(res, 200, { scenes: scenes.map((s) => s.sceneName) });
    } catch {
      sendJSON(res, 200, { scenes: [] });
    }
    return true;
  }

  // ── Buttons API ────────────────────────────────
  if (method === "GET" && pathname === "/api/buttons") {
    try {
      const result = await pool.query("SELECT * FROM buttons WHERE user_id = $1 ORDER BY position_order ASC", [userId]);
      sendJSON(res, 200, { buttons: result.rows });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/buttons") {
    try {
      const body = await parseBody(req);
      const btn = JSON.parse(body.toString());

      if (!btn.id || !btn.label || !btn.type) {
        sendJSON(res, 400, { error: "id, label, type required" });
        return true;
      }

      // Check duplicate ID for same user
      const dupRes = await pool.query("SELECT id FROM buttons WHERE id = $1 AND user_id = $2", [btn.id, userId]);
      if (dupRes.rows.length > 0) {
        sendJSON(res, 409, { error: "Button ID already exists" });
        return true;
      }

      // Calculate order
      const ordRes = await pool.query("SELECT COALESCE(MAX(position_order), 0) as max_ord FROM buttons WHERE user_id = $1", [userId]);
      const newOrder = parseInt(ordRes.rows[0].max_ord) + 1;

      await pool.query(
        "INSERT INTO buttons (id, user_id, label, icon, type, color, action, position_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [btn.id, userId, btn.label, btn.icon, btn.type, btn.color, JSON.stringify(btn.action), newOrder]
      );

      broadcastToDecks(userId, { type: "config-updated" });
      sendJSON(res, 201, btn);
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
    return true;
  }

  const putMatch = method === "PUT" && pathname.match(/^\/api\/buttons\/(.+)$/);
  if (putMatch) {
    try {
      const id = decodeURIComponent(putMatch[1]);
      const body = await parseBody(req);
      const updates = JSON.parse(body.toString());

      // Check if button exists for user
      const checkBtn = await pool.query("SELECT id FROM buttons WHERE id = $1 AND user_id = $2", [id, userId]);
      if (checkBtn.rows.length === 0) {
        sendJSON(res, 404, { error: "Button not found" });
        return true;
      }

      await pool.query(
        "UPDATE buttons SET label = $1, icon = $2, type = $3, color = $4, action = $5 WHERE id = $6 AND user_id = $7",
        [updates.label, updates.icon, updates.type, updates.color, JSON.stringify(updates.action), id, userId]
      );

      broadcastToDecks(userId, { type: "config-updated" });
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
    return true;
  }

  const delMatch = method === "DELETE" && pathname.match(/^\/api\/buttons\/(.+)$/);
  if (delMatch) {
    try {
      const id = decodeURIComponent(delMatch[1]);
      const checkBtn = await pool.query("SELECT id FROM buttons WHERE id = $1 AND user_id = $2", [id, userId]);
      if (checkBtn.rows.length === 0) {
        sendJSON(res, 404, { error: "Button not found" });
        return true;
      }

      await pool.query("DELETE FROM buttons WHERE id = $1 AND user_id = $2", [id, userId]);
      broadcastToDecks(userId, { type: "config-updated" });
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  // ── Reorder API ─────────────────────────────────
  if (method === "PUT" && pathname === "/api/buttons-reorder") {
    try {
      const body = await parseBody(req);
      const { order } = JSON.parse(body.toString());
      if (!Array.isArray(order)) {
        sendJSON(res, 400, { error: "order must be array" });
        return true;
      }

      // Perform updates inside a transaction
      await pool.query("BEGIN");
      for (let i = 0; i < order.length; i++) {
        await pool.query(
          "UPDATE buttons SET position_order = $1 WHERE id = $2 AND user_id = $3",
          [i, order[i], userId]
        );
      }
      await pool.query("COMMIT");

      broadcastToDecks(userId, { type: "config-updated" });
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      await pool.query("ROLLBACK");
      sendJSON(res, 400, { error: err.message });
    }
    return true;
  }

  // ── Upload API (User disk folder isolation) ─────
  if (method === "POST" && pathname === "/api/upload") {
    try {
      const body = await parseBody(req);
      const parts = parseMultipart(req, body);
      if (!parts || parts.length === 0) {
        sendJSON(res, 400, { error: "No file provided" });
        return true;
      }

      const uploaded = [];
      const userMediaDir = path.join(MEDIA_DIR, String(userId));
      fs.mkdirSync(userMediaDir, { recursive: true });

      for (const part of parts) {
        if (!part.filename) continue;
        const safe = part.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const ext = path.extname(safe).toLowerCase();
        if (!MEDIA_EXTS.includes(ext)) continue;

        const dest = path.join(userMediaDir, safe);
        fs.writeFileSync(dest, part.data);

        const relativeUrl = `/media/${userId}/${safe}`;
        const isAudio = AUDIO_EXTS.includes(ext);

        // Record in DB
        const dbRes = await pool.query(
          "INSERT INTO media (user_id, filename, url, file_size, file_type) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [userId, safe, relativeUrl, part.data.length, isAudio ? "audio" : "visual"]
        );

        uploaded.push({
          id: dbRes.rows[0].id,
          filename: safe,
          url: relativeUrl,
          size: part.data.length,
          type: isAudio ? "audio" : "visual",
        });

        console.log(`[Upload - User ${userId}] ${safe} (${(part.data.length / 1024).toFixed(1)}KB)`);
      }

      if (uploaded.length === 0) {
        sendJSON(res, 400, { error: "No valid files uploaded" });
        return true;
      }

      sendJSON(res, 201, { uploaded });
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
    return true;
  }

  // ── Media List ─────────────────────────────────
  if (method === "GET" && pathname === "/api/media") {
    try {
      const userRes = await pool.query("SELECT access_key FROM users WHERE id = $1", [userId]);
      const accessKey = userRes.rows[0].access_key;
      const result = await pool.query("SELECT * FROM media WHERE user_id = $1 ORDER BY uploaded_at DESC", [userId]);
      sendJSON(res, 200, {
        files: result.rows.map((row) => ({
          filename: row.filename,
          url: `${row.url}?key=${accessKey}`,
          size: row.file_size,
          type: row.file_type,
        })),
      });
    } catch {
      sendJSON(res, 200, { files: [] });
    }
    return true;
  }

  return false;
}

// ── Static file server ──────────────────────────────────
function createServer(baseDir, withAPI = false) {
  return http.createServer(async (req, res) => {
    if (withAPI && req.url.startsWith("/api/")) {
      const handled = await handleAPI(req, res);
      if (handled) return;
    }

    let filePath;
    // Map persistent routes /config/ and /media/
    if (req.url.startsWith("/config/") || req.url.startsWith("/media/")) {
      filePath = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    } else {
      let resolved = decodeURIComponent(req.url.split("?")[0]);
      if (resolved.endsWith("/")) resolved += "index.html";
      filePath = path.join(baseDir, resolved);
    }

    // Media user authorization: only allow loading if the token key is present in request or referer header
    // In OBS browser source loading media, it passes parameters. Let's make it fully robust by checking key
    if (req.url.startsWith("/media/")) {
      // Validate that access to `/media/:userId/` matches the user credentials
      const pathParts = req.url.split("/");
      const targetUserId = parseInt(pathParts[2]);

      const isAuthenticated = await authenticateUser(req);
      if (!isAuthenticated || req.userId !== targetUserId) {
        // As a friendly fallback for OBS Browser Sources loading overlay assets, 
        // we can also check the referer URL parameter for access validation
        let authorizedReferer = false;
        const referer = req.headers["referer"];
        if (referer) {
          try {
            const refUrl = new URL(referer);
            const refKey = refUrl.searchParams.get("key");
            if (refKey) {
              const checkKey = await pool.query("SELECT id FROM users WHERE access_key = $1", [refKey]);
              if (checkKey.rows.length > 0 && checkKey.rows[0].id === targetUserId) {
                authorizedReferer = true;
              }
            }
          } catch (e) {}
        }

        if (!authorizedReferer) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden - Unauthorized Media Access");
          return;
        }
      }
    }

    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
    } catch {}

    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME[ext] || "application/octet-stream";

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404");
        return;
      }
      res.writeHead(200, {
        "Content-Type": ct,
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
  });
}

// ── Start servers ───────────────────────────────────────
const deckServer = createServer(path.join(ROOT, "deck"), true);
const overlayServer = createServer(path.join(ROOT, "overlay"), false);

// ── OBS WebSocket HTTP Proxy (Multi-Tenant Secure Proxy) ─
const obsProxyWss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols, request) => {
    return protocols.size > 0 ? Array.from(protocols)[0] : false;
  },
});

obsProxyWss.on("connection", async (ws, request) => {
  const urlParams = new URL(request.url, `http://${request.headers.host}`);
  const key = urlParams.searchParams.get("key");

  if (!key) {
    console.error("[OBS Proxy] Denied connection: No access key provided");
    ws.close();
    return;
  }

  try {
    const userRes = await pool.query("SELECT id FROM users WHERE access_key = $1", [key]);
    if (userRes.rows.length === 0) {
      console.error("[OBS Proxy] Denied connection: Invalid access key");
      ws.close();
      return;
    }

    const userId = userRes.rows[0].id;
    const settingsRes = await pool.query("SELECT * FROM settings WHERE user_id = $1", [userId]);
    if (settingsRes.rows.length === 0 || !settingsRes.rows[0].obs_host) {
      console.error(`[OBS Proxy - User ${userId}] Denied: No OBS host configured`);
      ws.close();
      return;
    }

    const row = settingsRes.rows[0];
    const obsUrl = `ws://${row.obs_host}:${row.obs_port}`;
    console.log(`[OBS Proxy - User ${userId}] Connecting to ${obsUrl}...`);

    const protocols = request.headers["sec-websocket-protocol"]
      ? request.headers["sec-websocket-protocol"].split(",").map((s) => s.trim())
      : [];

    const targetWs = new WebSocket(obsUrl, protocols);

    targetWs.on("open", () => {
      console.log(`[OBS Proxy - User ${userId}] Connected to OBS Studio`);
    });

    targetWs.on("message", (msg) => {
      if (ws.readyState === 1) ws.send(msg);
    });

    targetWs.on("close", (code, reason) => {
      console.log(`[OBS Proxy - User ${userId}] Target closed: ${code} ${reason}`);
      ws.close();
    });

    targetWs.on("error", (err) => {
      console.error(`[OBS Proxy - User ${userId}] Target error:`, err);
      ws.close();
    });

    ws.on("message", (msg) => {
      if (targetWs.readyState === 1) targetWs.send(msg);
    });

    ws.on("close", (code, reason) => {
      console.log(`[OBS Proxy - User ${userId}] Client closed: ${code} ${reason}`);
      targetWs.close();
    });

    ws.on("error", (err) => {
      console.error(`[OBS Proxy - User ${userId}] Client error:`, err);
      targetWs.close();
    });
  } catch (e) {
    console.error("[OBS Proxy] DB exception:", e.message);
    ws.close();
  }
});

deckServer.on("upgrade", (request, socket, head) => {
  const urlParams = new URL(request.url, `http://${request.headers.host}`);
  if (urlParams.pathname === "/api/obs-proxy") {
    obsProxyWss.handleUpgrade(request, socket, head, (ws) => {
      obsProxyWss.emit("connection", ws, request);
    });
  }
});

// Initialize database and start servers
(async () => {
  await initDB();

  // Load all connections for existing users
  try {
    const res = await pool.query("SELECT id FROM users");
    for (const row of res.rows) {
      connectUserOBS(row.id).catch(() => {});
      connectUserSaweria(row.id).catch(() => {});
    }
  } catch (e) {
    console.error("[Startup - Active Streams] Error loading connections:", e.message);
  }

  deckServer.listen(DECK_PORT, () =>
    console.log(`✅ Deck UI:      http://localhost:${DECK_PORT}`)
  );
  overlayServer.listen(OVERLAY_PORT, () =>
    console.log(`✅ Overlay:      http://localhost:${OVERLAY_PORT}`)
  );
  console.log(`✅ WebSocket:    ws://localhost:${WS_PORT}`);
  console.log(`✅ Proxy WSS:    ws://localhost:${DECK_PORT}/api/obs-proxy`);
  console.log(`✅ API:          http://localhost:${DECK_PORT}/api/`);
  console.log("");
})();
