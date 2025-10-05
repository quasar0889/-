// server/server.js
import express from "express";
import cors from "cors";
import { Pool } from "pg";
import { Server } from "socket.io";
import http from "http";

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// DB初期化
app.get("/api/init", async (req, res) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bounties (
      id SERIAL PRIMARY KEY,
      title TEXT,
      description TEXT,
      reward INTEGER,
      image_url TEXT,
      deadline TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  res.json({ ok: true });
});

// 一覧取得
app.get("/api/bounties", async (req, res) => {
  const result = await pool.query("SELECT * FROM bounties ORDER BY id DESC");
  res.json(result.rows);
});

// 作成
app.post("/api/bounties", async (req, res) => {
  const { title, description, reward, image_url, deadline } = req.body;
  const result = await pool.query(
    "INSERT INTO bounties (title, description, reward, image_url, deadline) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [title, description, reward, image_url, deadline]
  );
  const bounty = result.rows[0];
  io.emit("new_bounty", bounty); // 🔥 全クライアントに通知
  res.json({ ok: true });
});

// Socket.io接続ログ
io.on("connection", (socket) => {
  console.log("🟢 client connected:", socket.id);
  socket.on("disconnect", () => console.log("🔴 disconnected:", socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ API & Socket.IO running on ${PORT}`));
