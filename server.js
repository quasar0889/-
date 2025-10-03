require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// ----------------- Utilities -----------------
function generateJWT(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

async function verifyToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'No token' });
  const token = auth.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ----------------- Socket.IO -----------------
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
});

// ----------------- User Auth -----------------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO users (username,password_hash,balance) VALUES ($1,$2,100) RETURNING id,username,balance', [username, hash]);
    const token = generateJWT(r.rows[0]);
    res.json({ user: r.rows[0], token });
  } catch (err) {
    if (err.code === '23505') res.status(400).json({ error: 'username exists' });
    else res.status(500).json({ error: 'internal error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });
  try {
    const r = await pool.query('SELECT id,username,password_hash,balance FROM users WHERE username=$1', [username]);
    if (!r.rows.length) return res.status(400).json({ error: 'invalid credentials' });
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'invalid credentials' });
    const token = generateJWT(user);
    res.json({ user: { id: user.id, username: user.username, balance: user.balance }, token });
  } catch (err) { res.status(500).json({ error: 'internal error' }); }
});

app.get('/api/me', verifyToken, async (req, res) => {
  const r = await pool.query('SELECT id,username,balance FROM users WHERE id=$1', [req.user.id]);
  res.json(r.rows[0]);
});

// ----------------- Bounties -----------------
app.get('/api/bounties', async (req, res) => {
  const r = await pool.query(
    `SELECT b.*, u.username as created_by_name FROM bounties b JOIN users u ON b.created_by=u.id ORDER BY b.created_at DESC`
  );
  res.json(r.rows);
});

app.post('/api/bounties', verifyToken, async (req, res) => {
  const { title, description, reward } = req.body || {};
  if (!title || !reward || reward <= 0) return res.status(400).json({ error: 'invalid input' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ur = await client.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    if (!ur.rows.length) throw new Error('user not found');
    if (ur.rows[0].balance < reward) throw new Error('insufficient balance');

    await client.query('UPDATE users SET balance=balance-$1 WHERE id=$2', [reward, req.user.id]);
    await client.query('INSERT INTO transactions (id,user_id,change_amount,kind,metadata) VALUES ($1,$2,$3,$4,$5)', [uuidv4(), req.user.id, -reward, 'bounty_post', JSON.stringify({ title })]);

    const br = await client.query('INSERT INTO bounties (title,description,reward,created_by) VALUES ($1,$2,$3,$4) RETURNING *', [title, description, reward, req.user.id]);

    await client.query('COMMIT');
    io.emit('new_bounty', br.rows[0]);
    res.json(br.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ----------------- Applications -----------------
app.post('/api/bounties/:id/apply', verifyToken, async (req, res) => {
  const bountyId = parseInt(req.params.id, 10);
  const r = await pool.query('INSERT INTO applications (bounty_id,user_id) VALUES ($1,$2) RETURNING *', [bountyId, req.user.id]);
  io.emit('new_application', r.rows[0]);
  res.json(r.rows[0]);
});

app.get('/api/bounties/:id/applications', verifyToken, async (req, res) => {
  const bountyId = parseInt(req.params.id, 10);
  const r = await pool.query('SELECT a.*, u.username FROM applications a JOIN users u ON a.user_id=u.id WHERE a.bounty_id=$1', [bountyId]);
  res.json(r.rows);
});

// ----------------- Comments -----------------
app.post('/api/bounties/:id/comments', verifyToken, async (req,res) => {
  const bountyId = parseInt(req.params.id,10);
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error:'message required' });
  const r = await pool.query('INSERT INTO comments (bounty_id,user_id,message) VALUES ($1,$2,$3) RETURNING *', [bountyId, req.user.id, message]);
  io.emit('new_comment', r.rows[0]);
  res.json(r.rows[0]);
});

app.get('/api/bounties/:id/comments', async (req,res) => {
  const bountyId = parseInt(req.params.id,10);
  const r = await pool.query('SELECT c.*, u.username FROM comments c JOIN users u ON c.user_id=u.id WHERE c.bounty_id=$1 ORDER BY c.created_at ASC', [bountyId]);
  res.json(r.rows);
});

// ----------------- Complete Bounty -----------------
app.post('/api/bounties/:id/complete', verifyToken, async (req,res) => {
  const bountyId = parseInt(req.params.id,10);
  const { winnerId } = req.body || {};
  if (!winnerId) return res.status(400).json({ error:'winnerId required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const br = await client.query('SELECT * FROM bounties WHERE id=$1 FOR UPDATE', [bountyId]);
    if (!br.rows.length) throw new Error('bounty not found');
    const bounty = br.rows[0];
    if (bounty.created_by !== req.user.id) throw new Error('only creator can complete');
    if (bounty.status !== 'open') throw new Error('not open');

    await client.query('UPDATE bounties SET status=$1,assigned_to=$2,updated_at=now() WHERE id=$3',['completed',winnerId,bountyId]);
    await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[bounty.reward,winnerId]);
    await client.query('INSERT INTO transactions (id,user_id,change_amount,kind,metadata) VALUES ($1,$2,$3,$4,$5)', [uuidv4(), winnerId, bounty.reward, 'bounty_award', JSON.stringify({ bountyId })]);
    await client.query('COMMIT');
    io.emit('bounty_completed', { bountyId, winnerId });
    res.json({ message:'completed' });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ----------------- File Upload -----------------
const uploadDir = path.join(__dirname,'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req,file,cb)=>cb(null,uploadDir),
  filename: (req,file,cb)=>cb(null,Date.now()+'_'+file.originalname)
});
const upload = multer({ storage });

app.post('/api/bounties/:id/upload', verifyToken, upload.single('file'), async (req,res)=>{
  const bountyId = parseInt(req.params.id,10);
  const file = req.file;
  if(!file) return res.status(400).json({ error:'file required' });
  const r = await pool.query('INSERT INTO attachments (bounty_id,user_id,filename,filepath) VALUES ($1,$2,$3,$4) RETURNING *', [bountyId, req.user.id, file.originalname, file.path]);
  io.emit('new_attachment', r.rows[0]);
  res.json(r.rows[0]);
});

app.get('/api/bounties/:id/attachments', async (req,res)=>{
  const bountyId = parseInt(req.params.id,10);
  const r = await pool.query('SELECT * FROM attachments WHERE bounty_id=$1', [bountyId]);
  res.json(r.rows);
});

// ----------------- Transactions -----------------
app.get('/api/transactions/me', verifyToken, async (req,res)=>{
  const r = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);
  res.json(r.rows);
});

// ----------------- Fallback -----------------
app.get('*',(req,res)=>{
  res.sendFile(path.resolve(__dirname,'public','index.html'));
});

// ----------------- Start -----------------
const PORT = process.env.PORT || 3000;
server.listen(PORT,()=>console.log('Server running on',PORT));
