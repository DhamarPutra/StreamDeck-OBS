const { Pool, Client } = require("pg");

const dbName = process.env.DB_NAME || "streamdeck";

// Config for connecting to default system database to check/create target database
const defaultDbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: "postgres", // System database that always exists in standard PostgreSQL
};

// Target config
const targetDbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: dbName,
};

let pool = new Pool(targetDbConfig);

async function initDB() {
  let retries = 10;
  let defaultClient = null;

  // 1. First, connect to default system database "postgres" to verify server status
  while (retries) {
    try {
      defaultClient = new Client(defaultDbConfig);
      await defaultClient.connect();
      console.log("[DB] ✅ Connected to PostgreSQL database server");
      break;
    } catch (err) {
      console.log(`[DB] ⏳ Connecting to PostgreSQL... (${retries} retries left). Info: ${err.message}`);
      if (defaultClient) {
        try {
          await defaultClient.end();
        } catch (e) {}
      }
      retries -= 1;
      if (retries === 0) {
        console.error("[DB] ❌ Could not connect to PostgreSQL server:", err.message);
        process.exit(1);
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  // 2. Automically check and create target database if missing
  try {
    const res = await defaultClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (res.rows.length === 0) {
      console.log(`[DB] 🔨 Database "${dbName}" does not exist. Creating database...`);
      // Standard PostgreSQL CREATE DATABASE statement (interpolated safely as DB name)
      await defaultClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[DB] ✅ Database "${dbName}" created successfully`);
    }
  } catch (err) {
    console.error("[DB] ❌ Failed to check/create database:", err.message);
  } finally {
    try {
      await defaultClient.end();
    } catch (e) {}
  }

  // 3. Connect to the target database and build user-scoped schemas
  try {
    await pool.query("SELECT NOW()");
    console.log(`[DB] ✅ Connected to target database "${dbName}"`);
  } catch (err) {
    console.error(`[DB] ❌ Failed to connect to target database "${dbName}":`, err.message);
    process.exit(1);
  }

  // Create tables in sequence
  const createTablesQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      access_key VARCHAR(64) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS buttons (
      id VARCHAR(100) PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      label VARCHAR(100) NOT NULL,
      icon VARCHAR(10) NOT NULL,
      type VARCHAR(20) NOT NULL,
      color VARCHAR(7) NOT NULL,
      action JSONB NOT NULL,
      position_order INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      obs_host VARCHAR(255) DEFAULT 'localhost',
      obs_port INT DEFAULT 4455,
      obs_password VARCHAR(255) DEFAULT '',
      saweria_stream_key VARCHAR(255) DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      url VARCHAR(255) NOT NULL,
      file_size INT NOT NULL,
      file_type VARCHAR(20) NOT NULL,
      uploaded_at TIMESTAMP DEFAULT NOW()
    );
  `;

  try {
    await pool.query(createTablesQuery);
    console.log("[DB] ✅ Database tables initialized");

    // Auto-seed admin user if no users exist
    const userCheck = await pool.query("SELECT COUNT(*) FROM users");
    if (parseInt(userCheck.rows[0].count) === 0) {
      const bcrypt = require("bcryptjs");
      const crypto = require("crypto");
      const passwordHash = await bcrypt.hash("admin", 10);
      const accessKey = crypto.randomBytes(32).toString("hex");

      const userRes = await pool.query(
        "INSERT INTO users (username, password_hash, access_key) VALUES ($1, $2, $3) RETURNING id",
        ["admin", passwordHash, accessKey]
      );
      const newUserId = userRes.rows[0].id;
      await pool.query("INSERT INTO settings (user_id) VALUES ($1)", [newUserId]);
      console.log(`[DB] 🔑 Created default admin user - Username: admin, Password: admin, Access Key: ${accessKey}`);
    }
  } catch (err) {
    console.error("[DB] ❌ Failed to initialize tables:", err.message);
    process.exit(1);
  }
}

module.exports = {
  pool,
  initDB,
};
