const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "streamdeck",
});

async function initDB() {
  let retries = 10;
  while (retries) {
    try {
      // Test connection
      await pool.query("SELECT NOW()");
      console.log("[DB] ✅ Connected to PostgreSQL database");
      break;
    } catch (err) {
      console.log(`[DB] ⏳ Connecting to PostgreSQL... (${retries} retries left)`);
      retries -= 1;
      if (retries === 0) {
        console.error("[DB] ❌ Could not connect to PostgreSQL:", err.message);
        process.exit(1);
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
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
  } catch (err) {
    console.error("[DB] ❌ Failed to initialize tables:", err.message);
    process.exit(1);
  }
}

module.exports = {
  pool,
  initDB,
};
