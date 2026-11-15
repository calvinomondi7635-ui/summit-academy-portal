require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL || true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const query = (sql, params = []) => pool.query(sql, params);
const clean = value => String(value ?? "").trim();
const required = (obj, fields) => fields.filter(f => !clean(obj[f]));
const signToken = user => jwt.sign(
  { sub: user.id, role: user.role, name: user.full_name, email: user.email },
  JWT_SECRET,
  { expiresIn: "8h", issuer: "summit-academy" }
);

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in." });
  try {
    req.user = jwt.verify(token, JWT_SECRET, { issuer: "summit-academy" });
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}
const allow = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission to perform this action." });
  next();
};
const isPositiveId = v => /^\d+$/.test(String(v)) && Number(v) > 0;

app.get("/api/health", asyncRoute(async (req, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", database: "connected" });
}));

app.post("/api/login", asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const result = await query("SELECT id,full_name,email,phone,password_hash,role,active FROM users WHERE email=$1", [email]);
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  res.json({ token: signToken(user), user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role } });
}));

app.get("/api/me", auth, asyncRoute(async (req, res) => {
  const r = await query("SELECT id,full_name,email,phone,role FROM users WHERE id=$1 AND active=TRUE", [req.user.sub]);
  if (!r.rows[0]) return res.status(401).json({ error: "Account unavailable." });
  res.json(r.rows[0]);
}));

app.get("/api/dashboard", auth, asyncRoute(async (req, res) => {
  if (req.user.role === "parent") {
    const children = await query(`SELECT s.id,s.admission_no,s.first_name,s.last_name,c.name AS class_name
      FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.parent_user_id=$1 ORDER BY s.first_name`, [req.user.sub]);
    return res.json({ role: "parent", children: children.rows });
  }
  const [students, classes, staff, attendance, invoices, payments] = await Promise.all([
    query("SELECT COUNT(*)::int AS count FROM students WHERE status='Active'"),
    query("SELECT COUNT(*)::int AS count FROM classes"),
    query("SELECT COUNT(*)::int AS count FROM users WHERE role='teacher' AND active=TRUE"),
    query("SELECT COUNT(*)::int AS count FROM attendance WHERE attendance_date=CURRENT_DATE AND status='Present'"),
    query("SELECT COALESCE(SUM(amount),0) AS total FROM fee_invoices"),
    query("SELECT COALESCE(SUM(amount),0) AS total FROM fee_payments")
  ]);
  res.json({
    role: req.user.role,
    students: students.rows[0].count,
    classes: classes.rows[0].count,
    teachers: staff.rows[0].count,
    presentToday: attendance.rows[0].count,
    feesInvoiced: invoices.rows[0].total,
    feesCollected: payments.rows[0].total
  });
}));

// Classes
app.get("/api/classes", auth, asyncRoute(async (req, res) => {
  const r = await query(`SELECT c.*,u.full_name AS teacher_name FROM classes c LEFT JOIN users u ON u.id=c.class_teacher_id ORDER BY c.name`);
  res.json(r.rows);
}));
app.post("/api/classes", auth, allow("admin"), asyncRoute(async (req, res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ error: "Class name is required." });
  const r = await query("INSERT INTO classes(name) VALUES($1) RETURNING *", [name]);
  res.status(201).json(r.rows[0]);
}));

// Students
app.get("/api/students", auth, allow("admin","teacher"), asyncRoute(async (req, res) => {
  const search = `%${clean(req.query.search)}%`;
  const r = await query(`SELECT s.*,c.name AS class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id
    WHERE ($1='%%' OR s.first_name ILIKE $1 OR s.last_name ILIKE $1 OR s.admission_no ILIKE $1)
    ORDER BY s.created_at DESC LIMIT 500`, [search]);
  res.json(r.rows);
}));
app.post("/api/students", auth, allow("admin"), asyncRoute(async (req, res) => {
  const b = req.body;
  const missing = required(b, ["admission_no","first_name","last_name"]);
  if (missing.length) return res.status(400).json({ error: `Required: ${missing.join(", ")}` });
  const r = await query(`INSERT INTO students(admission_no,first_name,last_name,gender,date_of_birth,class_id,parent_name,parent_phone,parent_email,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [clean(b.admission_no),clean(b.first_name),clean(b.last_name),clean(b.gender)||null,b.date_of_birth||null,b.class_id||null,clean(b.parent_name)||null,clean(b.parent_phone)||null,clean(b.parent_email)||null,clean(b.status)||"Active"]);
  res.status(201).json(r.rows[0]);
}));
app.patch("/api/students/:id", auth, allow("admin"), asyncRoute(async (req, res) => {
  if (!isPositiveId(req.params.id)) return res.status(400).json({ error: "Invalid student ID." });
  const b = req.body;
  const r = await query(`UPDATE students SET first_name=COALESCE($1,first_name),last_name=COALESCE($2,last_name),
    class_id=COALESCE($3,class_id),status=COALESCE($4,status),parent_name=COALESCE($5,parent_name),
    parent_phone=COALESCE($6,parent_phone),parent_email=COALESCE($7,parent_email)
    WHERE id=$8 RETURNING *`,
    [b.first_name||null,b.last_name||null,b.class_id||null,b.status||null,b.parent_name||null,b.parent_phone||null,b.parent_email||null,req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Student not found." });
  res.json(r.rows[0]);
}));

// Staff and user accounts
app.get("/api/staff", auth, allow("admin"), asyncRoute(async (req, res) => {
  const r = await query("SELECT id,full_name,email,phone,role,active,created_at FROM users WHERE role IN ('teacher','admin') ORDER BY full_name");
  res.json(r.rows);
}));
app.post("/api/staff", auth, allow("admin"), asyncRoute(async (req, res) => {
  const b = req.body;
  const missing = required(b, ["full_name","email","password","role"]);
  if (missing.length) return res.status(400).json({ error: `Required: ${missing.join(", ")}` });
  if (!["teacher","parent","admin"].includes(b.role)) return res.status(400).json({ error: "Invalid role." });
  if (String(b.password).length < 10) return res.status(400).json({ error: "Use a password with at least 10 characters." });
  const hash = await bcrypt.hash(String(b.password), 12);
  const r = await query("INSERT INTO users(full_name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,full_name,email,phone,role",
    [clean(b.full_name),clean(b.email).toLowerCase(),clean(b.phone)||null,hash,b.role]);
  res.status(201).json(r.rows[0]);
}));

// Parent account linking (admin only): link an existing parent account to a learner
app.post("/api/students/:id/link-parent", auth, allow("admin"), asyncRoute(async (req, res) => {
  if (!isPositiveId(req.params.id)) return res.status(400).json({ error: "Invalid student ID." });
  const email = clean(req.body.email).toLowerCase();
  const parent = await query("SELECT id FROM users WHERE email=$1 AND role='parent' AND active=TRUE", [email]);
  if (!parent.rows[0]) return res.status(404).json({ error: "Create the parent account first." });
  const r = await query("UPDATE students SET parent_user_id=$1 WHERE id=$2 RETURNING id,admission_no,first_name,last_name", [parent.rows[0].id,req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Student not found." });
  res.json({ message: "Parent linked.", student: r.rows[0] });
}));

// Attendance
app.get("/api/attendance", auth, allow("admin","teacher"), asyncRoute(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);
  const r = await query(`SELECT a.*,s.admission_no,s.first_name,s.last_name FROM attendance a
    JOIN students s ON s.id=a.student_id WHERE a.attendance_date=$1 ORDER BY s.first_name,s.last_name`, [date]);
  res.json(r.rows);
}));
app.post("/api/attendance", auth, allow("admin","teacher"), asyncRoute(async (req, res) => {
  const b = req.body;
  if (!isPositiveId(b.student_id) || !["Present","Absent","Late","Excused"].includes(b.status) || !b.attendance_date)
    return res.status(400).json({ error: "Student, date and valid attendance status are required." });
  const r = await query(`INSERT INTO attendance(student_id,attendance_date,status,marked_by,notes)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(student_id,attendance_date)
    DO UPDATE SET status=EXCLUDED.status,marked_by=EXCLUDED.marked_by,notes=EXCLUDED.notes RETURNING *`,
    [b.student_id,b.attendance_date,b.status,req.user.sub,clean(b.notes)||null]);
  res.status(201).json(r.rows[0]);
}));

// Academic results
app.get("/api/results", auth, asyncRoute(async (req, res) => {
  let sql = `SELECT r.*,s.admission_no,s.first_name,s.last_name FROM results r JOIN students s ON s.id=r.student_id`;
  let params = [];
  if (req.user.role === "parent") { sql += " WHERE s.parent_user_id=$1"; params.push(req.user.sub); }
  sql += " ORDER BY r.created_at DESC LIMIT 500";
  const r = await query(sql, params);
  res.json(r.rows);
}));
app.post("/api/results", auth, allow("admin","teacher"), asyncRoute(async (req, res) => {
  const b = req.body;
  if (!isPositiveId(b.student_id) || !clean(b.subject) || !clean(b.assessment) || !clean(b.term) ||
      !Number.isFinite(Number(b.score)) || !Number.isFinite(Number(b.out_of)) || Number(b.score)<0 ||
      Number(b.out_of)<=0 || Number(b.score)>Number(b.out_of)) return res.status(400).json({ error: "Enter valid result details and a score not exceeding the maximum." });
  const r = await query(`INSERT INTO results(student_id,subject,assessment,score,out_of,term,academic_year,entered_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.student_id,clean(b.subject),clean(b.assessment),b.score,b.out_of,clean(b.term),Number(b.academic_year)||new Date().getFullYear(),req.user.sub]);
  res.status(201).json(r.rows[0]);
}));

// Fees: invoices and recorded payments. This is an internal ledger, not a payment gateway.
app.get("/api/fees", auth, asyncRoute(async (req, res) => {
  let sql = `SELECT i.*,s.admission_no,s.first_name,s.last_name,
    COALESCE((SELECT SUM(p.amount) FROM fee_payments p WHERE p.invoice_id=i.id),0) AS paid
    FROM fee_invoices i JOIN students s ON s.id=i.student_id`;
  const params = [];
  if (req.user.role === "parent") { sql += " WHERE s.parent_user_id=$1"; params.push(req.user.sub); }
  sql += " ORDER BY i.created_at DESC LIMIT 500";
  const r = await query(sql, params);
  res.json(r.rows.map(x => ({...x, balance: Number(x.amount)-Number(x.paid)})));
}));
app.post("/api/fees/invoices", auth, allow("admin"), asyncRoute(async (req, res) => {
  const b = req.body;
  if (!isPositiveId(b.student_id) || !clean(b.description) || Number(b.amount)<0 || !clean(b.term))
    return res.status(400).json({ error: "Student, description, non-negative amount and term are required." });
  const r = await query(`INSERT INTO fee_invoices(student_id,description,amount,due_date,term,academic_year)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.student_id,clean(b.description),b.amount,b.due_date||null,clean(b.term),Number(b.academic_year)||new Date().getFullYear()]);
  res.status(201).json(r.rows[0]);
}));
app.post("/api/fees/payments", auth, allow("admin"), asyncRoute(async (req, res) => {
  const b = req.body;
  if (!isPositiveId(b.invoice_id) || !Number.isFinite(Number(b.amount)) || Number(b.amount)<=0)
    return res.status(400).json({ error: "Invoice and positive payment amount are required." });
  const inv = await query("SELECT amount FROM fee_invoices WHERE id=$1", [b.invoice_id]);
  if (!inv.rows[0]) return res.status(404).json({ error: "Invoice not found." });
  const paid = await query("SELECT COALESCE(SUM(amount),0) AS total FROM fee_payments WHERE invoice_id=$1", [b.invoice_id]);
  if (Number(paid.rows[0].total)+Number(b.amount)>Number(inv.rows[0].amount))
    return res.status(400).json({ error: "Payment exceeds the remaining invoice balance." });
  const r = await query("INSERT INTO fee_payments(invoice_id,amount,method,reference,received_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [b.invoice_id,b.amount,clean(b.method)||"Cash",clean(b.reference)||null,req.user.sub]);
  res.status(201).json(r.rows[0]);
}));

// Announcements
app.get("/api/announcements", auth, asyncRoute(async (req, res) => {
  const r = await query(`SELECT a.*,u.full_name AS author FROM announcements a LEFT JOIN users u ON u.id=a.created_by
    WHERE a.audience='All' OR a.audience=$1 ORDER BY a.created_at DESC LIMIT 100`, [req.user.role]);
  res.json(r.rows);
}));
app.post("/api/announcements", auth, allow("admin"), asyncRoute(async (req, res) => {
  const b=req.body;
  if (!clean(b.title)||!clean(b.body)) return res.status(400).json({error:"Title and message are required."});
  const r=await query("INSERT INTO announcements(title,body,audience,created_by) VALUES($1,$2,$3,$4) RETURNING *",
    [clean(b.title),clean(b.body),["All","teacher","parent"].includes(b.audience)?b.audience:"All",req.user.sub]);
  res.status(201).json(r.rows[0]);
}));

// Secure inbox: users can read messages addressed to them and send messages to school/admin.
app.get("/api/messages", auth, asyncRoute(async (req,res)=>{
  const r=await query(`SELECT m.*,u.full_name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.recipient_id=$1 OR (m.recipient_id IS NULL AND $2='admin') ORDER BY m.created_at DESC LIMIT 100`,
    [req.user.sub,req.user.role]);
  res.json(r.rows);
}));
app.post("/api/messages", auth, asyncRoute(async (req,res)=>{
  const b=req.body;
  if(!clean(b.subject)||!clean(b.body)) return res.status(400).json({error:"Subject and message are required."});
  let recipient = null;
  if(req.user.role==="admin" && b.recipient_id && isPositiveId(b.recipient_id)) recipient=Number(b.recipient_id);
  const r=await query("INSERT INTO messages(sender_id,recipient_id,subject,body) VALUES($1,$2,$3,$4) RETURNING *",
    [req.user.sub,recipient,clean(b.subject),clean(b.body)]);
  res.status(201).json(r.rows[0]);
}));

app.use("/api", (req,res)=>res.status(404).json({error:"API endpoint not found."}));
app.use((err,req,res,next)=>{
  console.error(err);
  if (err.code==="23505") return res.status(409).json({error:"That record already exists. Check the admission number, email or class name."});
  if (err.code==="23503") return res.status(400).json({error:"A linked record does not exist. Check the selected student, class or user."});
  res.status(500).json({error: process.env.NODE_ENV==="production" ? "An unexpected server error occurred." : err.message});
});

async function initialize() {
  const schema = fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8");
  await query(schema);
  const email=clean(process.env.ADMIN_EMAIL || "admin@summitacademy.test").toLowerCase();
  const password=process.env.ADMIN_PASSWORD;
  if (!password || password.length<10) throw new Error("Set ADMIN_PASSWORD (at least 10 characters) in your .env before starting.");
  const existing=await query("SELECT id FROM users WHERE email=$1",[email]);
  if (!existing.rowCount) {
    const hash=await bcrypt.hash(password,12);
    await query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'admin')",
      [clean(process.env.ADMIN_NAME)||"System Administrator",email,hash]);
    console.log(`Initial administrator created: ${email}`);
  }
  app.listen(PORT,()=>console.log(`Summit Academy portal running on http://localhost:${PORT}`));
}
initialize().catch(err=>{console.error("Startup failed:",err);process.exit(1);});
