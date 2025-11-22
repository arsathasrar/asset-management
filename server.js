require('dotenv').config(); // Load .env
const express = require("express");
const { Pool } = require("pg");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const path = require("path");
const PDFDocument = require("pdfkit"); // PDF generation
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

const cors = require("cors");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.use(cors({
  origin: "http://localhost:5173", // frontend origin
  credentials: true
}));

// Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // true in production with HTTPS
    maxAge: 1000 * 60 * 60
  }
}));

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.on("connect", () => console.log("✅ Connected to PostgreSQL"));
pool.on("error", (err) => console.error("DB error:", err));

// --- Users table setup ---
async function createUsersTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL
      )
    `);
    console.log("Users table ready");
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
  }
}
createUsersTable();

// --- Function to create users ---
async function createUser(username, password, role) {
  const client = await pool.connect();
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await client.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING",
      [username, hashedPassword, role]
    );
    console.log(`User ${username} created`);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
  }
}
// Example users
createUser("admin", "admin123", "admin");
createUser("user1", "user123", "user");
createUser("user2", "user456", "user");

// --- Assets tables setup ---
const validTables = [
  "assets","employees","maintenance_logs","documents","depreciation_history",
  "it_hardware","software_license","locations","machinery_equipment","digital_media",
  "vehicles","real_estate","furniture","financial_assets","infrastructure",
  "tools","leased_assets","intellectual_property"
];

async function createTables() {
  const client = await pool.connect();
  try {
    for (const table of validTables) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          serial_number TEXT,
          employee_name TEXT,
          qr_code TEXT,
          barcode TEXT,
          submitted_by TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS update_${table}_updated_at ON ${table};
        CREATE TRIGGER update_${table}_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW
        EXECUTE PROCEDURE update_updated_at_column();
      `);

      console.log(`Table ${table} ready`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
  }
}
createTables();

// --- Middleware to protect routes ---
function isAuthenticated(req, res, next) {
  if (req.session.user) next();
  else res.status(401).json({ success: false, error: "Unauthorized" });
}

// --- Login API ---
// --- Login API ---
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: "Username and password required" });

  const client = await pool.connect();
  try {
    const result = await client.query("SELECT * FROM users WHERE username=$1", [username]);
    if (result.rows.length === 0) return res.json({ success: false, error: "Invalid username or password" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, error: "Invalid username or password" });

    req.session.user = { username: user.username, role: user.role };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// --- Forgot Password (Request Reset) ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.post("/forgot-password", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: "Username is required" });

  const client = await pool.connect();
  try {
    const userRes = await client.query("SELECT * FROM users WHERE username=$1", [username]);
    if (userRes.rows.length === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + (parseInt(process.env.RESET_TOKEN_EXPIRY) || 3600); // Store as Unix timestamp in seconds

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        username TEXT,
        token TEXT,
        expires_at INTEGER
      )
    `);

    await client.query("DELETE FROM password_resets WHERE username=$1", [username]);
    await client.query("INSERT INTO password_resets (username, token, expires_at) VALUES ($1,$2,$3)", [username, token, expiresAt]);

    const resetLink = `http://localhost:3000/reset-password.html?token=${token}`;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: "Password Reset Request",
      html: `
        <p>You requested a password reset for your Asset Management account.</p>
        <p>Click the link below to reset your password (valid for 1 hour):</p>
        <a href="${resetLink}">${resetLink}</a>
      `,
    });

    res.json({ success: true, message: "Reset link sent to your email." });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ success: false, message: "Error sending reset link." });
  } finally {
    client.release();
  }
});

// --- Reset Password using token ---
app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ success: false, message: "Token and new password required" });

  const client = await pool.connect();
  try {
    const tokenRes = await client.query("SELECT * FROM password_resets WHERE token=$1", [token]);
    if (tokenRes.rows.length === 0)
      return res.status(400).json({ success: false, message: "Invalid or expired token" });

    const resetEntry = tokenRes.rows[0];
    if (Math.floor(Date.now() / 1000) > resetEntry.expires_at)
      return res.status(400).json({ success: false, message: "Token expired" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await client.query("UPDATE users SET password=$1 WHERE username=$2", [hashedPassword, resetEntry.username]);
    await client.query("DELETE FROM password_resets WHERE username=$1", [resetEntry.username]);

    res.json({ success: true, message: "Password successfully reset" });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ success: false, message: "Error resetting password" });
  } finally {
    client.release();
  } 
});

// --- Logout API ---
app.post("/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- History API ---
app.get("/api/history", isAuthenticated, async (req, res) => {
  const client = await pool.connect();
  try {
    let history = [];
    for (const table of validTables) {
      const result = await client.query(
        `SELECT id, name, serial_number, employee_name, submitted_by, created_at FROM ${table}`
      );
      result.rows.forEach(row => row.category = table);
      history = history.concat(result.rows);
    }
    history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Download History as PDF ---
app.get("/api/history/pdf", isAuthenticated, async (req, res) => {
  const client = await pool.connect();
  try {
    let history = [];
    for (const table of validTables) {
      const result = await client.query(
        `SELECT id, name, serial_number, employee_name, submitted_by, created_at FROM ${table}`
      );
      result.rows.forEach(row => row.category = table);
      history = history.concat(result.rows);
    }
    history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=history.pdf");
    doc.pipe(res);

    doc.fontSize(18).font("Helvetica-Bold").text("Asset History Report", { align: "center" });
    doc.moveDown(1);

    const tableTop = doc.y;
    const rowHeight = 20;
    const colWidths = {
      id: 40, category: 100, name: 120, serial_number: 100,
      employee_name: 120, submitted_by: 100, created_at: 120
    };
    const startX = doc.page.margins.left;

    doc.fontSize(10).font("Helvetica-Bold");
    let x = startX;
    ["ID","Category","Name","Serial Number","Employee Name","Submitted By","Created At"].forEach((header, i) => {
      doc.text(header, x, tableTop, { width: Object.values(colWidths)[i], align: "left" });
      x += Object.values(colWidths)[i];
    });

    doc.font("Helvetica");
    let y = tableTop + rowHeight;

    history.forEach((row) => {
      x = startX;
      [
        row.id, row.category, row.name || "-", row.serial_number || "-",
        row.employee_name || "-", row.submitted_by || "-",
        new Date(row.created_at).toLocaleString()
      ].forEach((text, i) => {
        doc.text(text.toString(), x, y, { width: Object.values(colWidths)[i], align: "left" });
        x += Object.values(colWidths)[i];
      });
      y += rowHeight;

      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage({ layout: "landscape" });
        y = doc.page.margins.top;
      }
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Asset routes (protected) ---
app.post("/api/assets/:category", isAuthenticated, async (req, res) => {
  const category = req.params.category;
  if (!validTables.includes(category)) return res.status(400).json({ error: "Invalid category" });

  const { name, serial_number, employee_name } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const client = await pool.connect();
  try {
    const qrImage = await QRCode.toDataURL(`${name}-${category}-${serial_number || ""}-${employee_name || ""}`);
    const barcodePng = await bwipjs.toBuffer({
      bcid: "code128", text: serial_number || name, scale: 3, height: 10,
      includetext: true, textxalign: "center"
    });
    const barcodeImage = `data:image/png;base64,${barcodePng.toString("base64")}`;

    const submittedBy = req.session.user.username;

    const result = await client.query(
      `INSERT INTO ${category} (name, serial_number, employee_name, qr_code, barcode, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, serial_number || null, employee_name || null, qrImage, barcodeImage, submittedBy]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/api/assets/:category", isAuthenticated, async (req, res) => {
  const category = req.params.category;
  if (!validTables.includes(category)) return res.status(400).json({ error: "Invalid category" });

  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT * FROM ${category} ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- Current user info ---
app.get("/me", (req, res) => {
  if (req.session.user) res.json({ loggedIn: true, username: req.session.user.username, role: req.session.user.role });
  else res.json({ loggedIn: false });
});

// --- Start server ---
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

