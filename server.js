require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const {
  db, siteWithStages, listSites, logWithPhotos, equipmentFor, createEquipmentStages, readingsFor,
  typeOf, typeExists, outOfRange, listSiteTypes, createSiteType,
} = require("./db");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
const UPLOADS = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "data", "uploads"));

if (!SECRET || SECRET.length < 24) {
  console.error("\n  JWT_SECRET is missing or too short.");
  console.error("  Run `node setup.js` locally, or set JWT_SECRET in your host's");
  console.error("  environment settings to a long random string.\n");
  process.exit(1);
}
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, UPLOADS),
    filename: (_r, file, cb) =>
      cb(null, Date.now() + "-" + crypto.randomBytes(4).toString("hex") + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (_r, file, cb) => cb(null, /^image\/(jpe?g|png|webp|heic)$/i.test(file.mimetype)),
});

const todayStr = () => new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------------- */
/*  Auth and tenancy                                                 */
/* ---------------------------------------------------------------- */

const sign = (u) => jwt.sign({ id: u.id, org: u.org_id }, SECRET, { expiresIn: "30d" });

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  try {
    const claims = jwt.verify(token, SECRET);
    const user = db
      .prepare("SELECT id, org_id, name, email, role, phone FROM users WHERE id = ?")
      .get(claims.id);
    if (!user) return res.status(401).json({ error: "That account no longer exists." });
    req.user = user;
    req.org = user.org_id; // every query below is scoped to this
    next();
  } catch (e) {
    res.status(401).json({ error: "Your session expired. Sign in again." });
  }
}

function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: "Your role can't make that change." });
}

// Confirms a site belongs to the caller's organisation before anything touches it.
function ownSite(req, res, next) {
  const id = Number(req.params.siteId || req.params.id || req.body.site_id);
  if (!id) return res.status(400).json({ error: "Which site?" });
  const row = db.prepare("SELECT id FROM sites WHERE id = ? AND org_id = ?").get(id, req.org);
  if (!row) return res.status(404).json({ error: "No such site." });
  req.siteId = id;
  next();
}

const TYPE_ACCENTS = ["general", "agro", "met", "petro", "cold"];

function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

const numOrUndef = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

app.get("/api/site-types", auth, (req, res) => res.json(listSiteTypes(req.org)));

// Anyone who can create a site can define a new kind of site — it's scoped to
// their own organisation, same as everything else, and shows up in the "what
// kind of site?" list immediately.
app.post("/api/site-types", auth, requireRole("owner", "lead"), (req, res) => {
  const { label, accent, stages, readings } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: "Give this kind of site a name." });

  const cleanStages = (Array.isArray(stages) ? stages : []).map((s) => String(s || "").trim()).filter(Boolean);
  if (!cleanStages.length) return res.status(400).json({ error: "Add at least one stage." });

  const cleanReadings = (Array.isArray(readings) ? readings : [])
    .filter((r) => r && r.label && String(r.label).trim())
    .map((r) => {
      const def = { key: slugify(r.key || r.label) || "value", label: String(r.label).trim(), unit: String(r.unit || "").trim() };
      const min = numOrUndef(r.min), max = numOrUndef(r.max);
      if (min !== undefined) def.min = min;
      if (max !== undefined) def.max = max;
      return def;
    });

  let key = slugify(label) || "site_type";
  let n = 2;
  while (typeExists(req.org, key)) key = `${slugify(label) || "site_type"}_${n++}`;

  createSiteType(req.org, {
    key, label: label.trim(),
    accent: TYPE_ACCENTS.includes(accent) ? accent : "general",
    stages: cleanStages, readings: cleanReadings,
  });
  res.json(listSiteTypes(req.org).find((t) => t.key === key));
});

app.post("/api/orgs", (req, res) => {
  const { org, name, email, password, phone } = req.body || {};
  if (!org || !name || !email || !password || password.length < 8)
    return res.status(400).json({ error: "Organisation, name, email and an 8+ character password are required." });

  const joinCode = org.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase() +
    "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  try {
    const create = db.transaction(() => {
      const o = db.prepare("INSERT INTO orgs (name, join_code) VALUES (?,?)").run(org.trim(), joinCode);
      const u = db
        .prepare("INSERT INTO users (org_id, name, email, phone, password_hash, role) VALUES (?,?,?,?,?,'owner')")
        .run(o.lastInsertRowid, name.trim(), email.trim().toLowerCase(), phone || "", bcrypt.hashSync(password, 10));
      return u.lastInsertRowid;
    });
    const user = db.prepare("SELECT id, org_id, name, email, role, phone FROM users WHERE id = ?").get(create());
    res.json({ token: sign(user), user, joinCode });
  } catch (e) {
    res.status(409).json({ error: "That email is already registered." });
  }
});

app.post("/api/auth/register", (req, res) => {
  const { name, email, password, phone, joinCode, role } = req.body || {};
  if (!name || !email || !password || password.length < 8)
    return res.status(400).json({ error: "Name, email and an 8+ character password are required." });

  const org = db.prepare("SELECT * FROM orgs WHERE join_code = ?").get((joinCode || "").trim().toUpperCase());
  if (!org) return res.status(403).json({ error: "That join code doesn't match any organisation." });

  const finalRole = ["lead", "officer", "tech"].includes(role) ? role : "tech";
  try {
    const info = db
      .prepare("INSERT INTO users (org_id, name, email, phone, password_hash, role) VALUES (?,?,?,?,?,?)")
      .run(org.id, name.trim(), email.trim().toLowerCase(), phone || "", bcrypt.hashSync(password, 10), finalRole);
    const user = db.prepare("SELECT id, org_id, name, email, role, phone FROM users WHERE id = ?").get(info.lastInsertRowid);
    res.json({ token: sign(user), user });
  } catch (e) {
    res.status(409).json({ error: "That email is already registered." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password || "", row.password_hash))
    return res.status(401).json({ error: "Email or password is wrong." });
  const user = { id: row.id, org_id: row.org_id, name: row.name, email: row.email, role: row.role, phone: row.phone };
  res.json({ token: sign(user), user });
});

app.get("/api/me", auth, (req, res) => {
  const org = db.prepare("SELECT id, name, join_code FROM orgs WHERE id = ?").get(req.org);
  res.json({ user: req.user, org: req.user.role === "owner" ? org : { id: org.id, name: org.name } });
});

app.get("/api/users", auth, (req, res) =>
  res.json(db.prepare("SELECT id, name, email, phone, role FROM users WHERE org_id = ? ORDER BY name").all(req.org))
);

app.patch("/api/users/:id/role", auth, requireRole("owner"), (req, res) => {
  const { role } = req.body || {};
  if (!["owner", "lead", "officer", "tech"].includes(role))
    return res.status(400).json({ error: "Unknown role." });
  const info = db.prepare("UPDATE users SET role = ? WHERE id = ? AND org_id = ?").run(role, req.params.id, req.org);
  if (!info.changes) return res.status(404).json({ error: "No such person in your organisation." });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- */
/*  Sites                                                            */
/* ---------------------------------------------------------------- */

app.get("/api/sites", auth, (req, res) => res.json(listSites(req.org)));

app.post("/api/sites", auth, requireRole("owner", "lead"), (req, res) => {
  const { name, site_type, location, client, contact_name, contact_phone, contact_email, start_date } = req.body || {};
  if (!name) return res.status(400).json({ error: "Give the site a name." });
  const type = typeExists(req.org, site_type) ? site_type : "general";

  const id = db
    .prepare(
      `INSERT INTO sites (org_id, name, site_type, location, client, contact_name, contact_phone, contact_email, start_date)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.org, name.trim(), type, location || "", client || "",
      contact_name || "", contact_phone || "", contact_email || "", start_date || todayStr()
    ).lastInsertRowid;

  res.json(siteWithStages(req.org, id));
});

app.get("/api/sites/:id", auth, ownSite, (req, res) => {
  const site = siteWithStages(req.org, req.siteId);
  site.readings = readingsFor(req.org, req.siteId, 40);
  site.reading_defs = typeOf(req.org, site.site_type).readings;
  site.logs = db
    .prepare("SELECT id FROM logs WHERE org_id = ? AND site_id = ? ORDER BY entry_date DESC, id DESC LIMIT 40")
    .all(req.org, req.siteId)
    .map((r) => logWithPhotos(req.org, r.id));
  res.json(site);
});

app.patch("/api/sites/:id", auth, requireRole("owner", "lead"), ownSite, (req, res) => {
  const cur = db.prepare("SELECT * FROM sites WHERE id = ?").get(req.siteId);
  const b = req.body || {};
  db.prepare(
    `UPDATE sites SET name=?, location=?, client=?, contact_name=?, contact_phone=?, contact_email=?, status=?
     WHERE id=? AND org_id=?`
  ).run(
    b.name ?? cur.name,
    b.location ?? cur.location,
    b.client ?? cur.client,
    b.contact_name ?? cur.contact_name,
    b.contact_phone ?? cur.contact_phone,
    b.contact_email ?? cur.contact_email,
    ["active", "on_hold", "complete"].includes(b.status) ? b.status : cur.status,
    req.siteId,
    req.org
  );
  res.json(siteWithStages(req.org, req.siteId));
});

app.delete("/api/sites/:id", auth, requireRole("owner"), ownSite, (req, res) => {
  db.prepare("DELETE FROM sites WHERE id = ? AND org_id = ?").run(req.siteId, req.org);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- */
/*  Equipment register                                               */
/* ---------------------------------------------------------------- */

app.get("/api/sites/:siteId/equipment", auth, ownSite, (req, res) =>
  res.json(equipmentFor(req.org, req.siteId))
);

app.post("/api/sites/:siteId/equipment", auth, requireRole("owner", "lead", "tech"), ownSite, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Give the equipment a name." });
  const site = db.prepare("SELECT site_type FROM sites WHERE id = ?").get(req.siteId);

  const create = db.transaction(() => {
    const id = db
      .prepare(
        `INSERT INTO equipment (org_id, site_id, name, make, model, serial, installed_on,
         last_service, service_days, calibration_due, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        req.org, req.siteId, b.name.trim(), b.make || "", b.model || "", b.serial || "",
        b.installed_on || null, b.last_service || null,
        b.service_days ? Number(b.service_days) : null, b.calibration_due || null, b.notes || ""
      ).lastInsertRowid;
    // New equipment gets the site type's commissioning checklist as its own,
    // independent progress — a site with several machines tracks each one separately.
    createEquipmentStages(req.org, id, typeOf(req.org, site.site_type).stages);
  });
  create();

  res.json(equipmentFor(req.org, req.siteId));
});

app.post("/api/equipment/:id/stages/:idx", auth, requireRole("owner", "lead", "tech"), (req, res) => {
  const e = db.prepare("SELECT id, site_id FROM equipment WHERE id = ? AND org_id = ?").get(req.params.id, req.org);
  if (!e) return res.status(404).json({ error: "No such equipment." });
  const done = req.body && req.body.done ? 1 : 0;
  const info = db
    .prepare(
      `UPDATE equipment_stages SET done=?, done_at = CASE WHEN ?=1 THEN date('now') ELSE NULL END,
       done_by = CASE WHEN ?=1 THEN ? ELSE NULL END
       WHERE equipment_id=? AND idx=?`
    )
    .run(done, done, done, req.user.name, e.id, req.params.idx);
  if (!info.changes) return res.status(404).json({ error: "No such stage." });
  res.json(equipmentFor(req.org, e.site_id));
});

app.patch("/api/equipment/:id", auth, requireRole("owner", "lead", "tech"), (req, res) => {
  const e = db.prepare("SELECT * FROM equipment WHERE id = ? AND org_id = ?").get(req.params.id, req.org);
  if (!e) return res.status(404).json({ error: "No such equipment." });
  const b = req.body || {};
  db.prepare(
    `UPDATE equipment SET name=?, make=?, model=?, serial=?, installed_on=?, last_service=?,
     service_days=?, calibration_due=?, notes=? WHERE id=? AND org_id=?`
  ).run(
    b.name ?? e.name, b.make ?? e.make, b.model ?? e.model, b.serial ?? e.serial,
    b.installed_on ?? e.installed_on, b.last_service ?? e.last_service,
    b.service_days === undefined ? e.service_days : Number(b.service_days) || null,
    b.calibration_due ?? e.calibration_due, b.notes ?? e.notes, e.id, req.org
  );
  res.json(equipmentFor(req.org, e.site_id));
});

app.post("/api/equipment/:id/check", auth, requireRole("owner", "lead", "tech"), (req, res) => {
  const e = db.prepare("SELECT site_id FROM equipment WHERE id = ? AND org_id = ?").get(req.params.id, req.org);
  if (!e) return res.status(404).json({ error: "No such equipment." });
  const checked = req.body && req.body.checked ? 1 : 0;
  db.prepare(
    `UPDATE equipment SET checked=?, checked_at = CASE WHEN ?=1 THEN date('now') ELSE NULL END,
     checked_by = CASE WHEN ?=1 THEN ? ELSE NULL END
     WHERE id=? AND org_id=?`
  ).run(checked, checked, checked, req.user.name, req.params.id, req.org);
  res.json(equipmentFor(req.org, e.site_id));
});

app.delete("/api/equipment/:id", auth, requireRole("owner", "lead"), (req, res) => {
  const e = db.prepare("SELECT * FROM equipment WHERE id = ? AND org_id = ?").get(req.params.id, req.org);
  if (!e) return res.status(404).json({ error: "No such equipment." });
  db.prepare("DELETE FROM equipment WHERE id = ? AND org_id = ?").run(e.id, req.org);
  res.json({ ok: true });
});

// Everything due or overdue across every site — the maintenance view.
app.get("/api/equipment/due", auth, (req, res) => {
  const sites = db.prepare("SELECT id, name FROM sites WHERE org_id = ?").all(req.org);
  const out = [];
  sites.forEach((s) =>
    equipmentFor(req.org, s.id)
      .filter((e) => e.status !== "ok")
      .forEach((e) => out.push({ ...e, site_name: s.name }))
  );
  out.sort((a, b) => (a.service_in_days ?? a.calibration_in_days ?? 0) - (b.service_in_days ?? b.calibration_in_days ?? 0));
  res.json(out);
});

/* ---------------------------------------------------------------- */
/*  Readings                                                         */
/* ---------------------------------------------------------------- */

app.get("/api/sites/:siteId/readings", auth, ownSite, (req, res) =>
  res.json(readingsFor(req.org, req.siteId, Number(req.query.limit) || 200))
);

app.post("/api/sites/:siteId/readings", auth, requireRole("owner", "lead", "tech"), ownSite, (req, res) => {
  const site = db.prepare("SELECT site_type FROM sites WHERE id = ?").get(req.siteId);
  const rows = Array.isArray(req.body.readings) ? req.body.readings : [req.body];
  const takenOn = req.body.taken_on || todayStr();

  const save = db.transaction(() => {
    const ins = db.prepare(
      `INSERT INTO readings (org_id, site_id, equipment_id, user_id, taken_on, param, value, unit, flagged, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    rows.forEach((r) => {
      if (!r.param || r.value === "" || r.value == null) return;
      const value = Number(r.value);
      if (Number.isNaN(value)) return;
      const def = typeOf(req.org, site.site_type).readings.find((d) => d.key === r.param);
      ins.run(
        req.org, req.siteId, r.equipment_id ? Number(r.equipment_id) : null, req.user.id,
        r.taken_on || takenOn, r.param, value, r.unit || (def ? def.unit : ""),
        outOfRange(req.org, site.site_type, r.param, value) ? 1 : 0, r.note || ""
      );
    });
  });
  save();
  res.json(readingsFor(req.org, req.siteId, 200));
});

/* ---------------------------------------------------------------- */
/*  Daily activity log                                               */
/* ---------------------------------------------------------------- */

app.get("/api/logs", auth, (req, res) => {
  const where = ["logs.org_id = ?"];
  const params = [req.org];
  if (req.query.siteId) { where.push("logs.site_id = ?"); params.push(req.query.siteId); }
  if (req.query.from) { where.push("logs.entry_date >= ?"); params.push(req.query.from); }
  if (req.query.severity) { where.push("logs.severity = ?"); params.push(req.query.severity); }
  const rows = db
    .prepare(`SELECT id FROM logs WHERE ${where.join(" AND ")} ORDER BY entry_date DESC, id DESC LIMIT 300`)
    .all(...params);
  res.json(rows.map((r) => logWithPhotos(req.org, r.id)));
});

app.post("/api/logs", auth, requireRole("owner", "lead", "tech"), upload.array("photos", 6), (req, res) => {
  const b = req.body || {};
  if (!b.work || !b.work.trim()) return res.status(400).json({ error: "Describe the work done." });
  if (b.site_id) {
    const ok = db.prepare("SELECT id FROM sites WHERE id = ? AND org_id = ?").get(b.site_id, req.org);
    if (!ok) return res.status(404).json({ error: "No such site." });
  }

  const save = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO logs (org_id, site_id, user_id, entry_date, work, crew, hours, severity, issue)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        req.org, b.site_id ? Number(b.site_id) : null, req.user.id,
        b.entry_date || todayStr(), b.work.trim(),
        b.crew ? Number(b.crew) : null, b.hours ? Number(b.hours) : null,
        ["none", "watch", "blocker"].includes(b.severity) ? b.severity : "none", b.issue || ""
      );
    const ins = db.prepare("INSERT INTO photos (org_id, log_id, filename) VALUES (?,?,?)");
    (req.files || []).forEach((f) => ins.run(req.org, info.lastInsertRowid, f.filename));
    return info.lastInsertRowid;
  });

  res.json(logWithPhotos(req.org, save()));
});

app.post("/api/logs/:id/resolve", auth, requireRole("owner", "lead", "tech"), (req, res) => {
  const info = db.prepare("UPDATE logs SET resolved = 1 WHERE id = ? AND org_id = ?").run(req.params.id, req.org);
  if (!info.changes) return res.status(404).json({ error: "No such entry." });
  res.json(logWithPhotos(req.org, req.params.id));
});

// Photos are only ever reachable through this route, and only if a row in
// this org's own photos table names that exact file — same org_id boundary
// as everything else, so a filename from another org 404s like it doesn't exist.
app.get("/api/photos/:filename", auth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const photo = db.prepare("SELECT filename FROM photos WHERE filename = ? AND org_id = ?").get(filename, req.org);
  if (!photo) return res.status(404).json({ error: "No such photo." });
  res.sendFile(path.join(UPLOADS, photo.filename));
});

/* ---------------------------------------------------------------- */
/*  Reports                                                          */
/* ---------------------------------------------------------------- */

const ROLE_LABEL = { owner: "account owner", lead: "site lead", officer: "senior officer", tech: "technician" };

function buildDraft(orgId, user, siteId) {
  const out = [];
  const sites = siteId
    ? [siteWithStages(orgId, siteId)].filter(Boolean)
    : listSites(orgId).filter((s) => s.status === "active");
  const org = db.prepare("SELECT name FROM orgs WHERE id = ?").get(orgId);

  out.push(`${org.name} — field progress to ${todayStr()}`);
  out.push("");
  sites.forEach((s) => {
    const pending = s.equipment.find((e) => e.percent < 100);
    const next = pending && pending.stages.find((x) => !x.done);
    const line = next ? `Next: ${pending.name} — ${next.name.toLowerCase()}`
      : s.equipment.length ? "All equipment commissioned" : "No equipment on the register yet";
    out.push(`${s.name} (${s.type_label}) — ${s.percent}%`);
    out.push(`  ${line}${s.open_blockers ? ` · ${s.open_blockers} open blocker(s)` : ""}`);
  });

  const week = db
    .prepare(
      `SELECT logs.entry_date, logs.work, sites.name AS site_name FROM logs
       LEFT JOIN sites ON sites.id = logs.site_id
       WHERE logs.org_id = ? AND logs.entry_date >= date('now','-7 day')
       ${siteId ? "AND logs.site_id = ?" : ""} ORDER BY logs.entry_date`
    )
    .all(...(siteId ? [orgId, siteId] : [orgId]));
  out.push("", `Work in the last 7 days (${week.length} entries)`);
  week.slice(0, 12).forEach((l) => out.push(`- ${l.entry_date} · ${l.site_name || "General"}: ${l.work}`));

  const flagged = db
    .prepare(
      `SELECT readings.param, readings.value, readings.unit, readings.taken_on, sites.name AS site_name
       FROM readings JOIN sites ON sites.id = readings.site_id
       WHERE readings.org_id = ? AND readings.flagged = 1 AND readings.taken_on >= date('now','-7 day')`
    )
    .all(orgId);
  if (flagged.length) {
    out.push("", "Readings outside expected range");
    flagged.forEach((r) => out.push(`- ${r.site_name} ${r.taken_on}: ${r.param} ${r.value}${r.unit || ""}`));
  }

  const blockers = db
    .prepare(
      `SELECT logs.issue, logs.work, sites.name AS site_name FROM logs
       LEFT JOIN sites ON sites.id = logs.site_id
       WHERE logs.org_id = ? AND logs.severity='blocker' AND logs.resolved=0`
    )
    .all(orgId);
  if (blockers.length) {
    out.push("", "Open blockers");
    blockers.forEach((b) => out.push(`- ${b.site_name || "General"}: ${b.issue || b.work}`));
  }

  out.push("", `Submitted by ${user.name}, ${ROLE_LABEL[user.role] || user.role}.`);
  return out.join("\n");
}

app.get("/api/reports/draft", auth, (req, res) =>
  res.json({
    title: `Field progress — ${todayStr()}`,
    body: buildDraft(req.org, req.user, req.query.siteId ? Number(req.query.siteId) : null),
  })
);

app.get("/api/reports", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT reports.*, users.name AS author, sites.name AS site_name FROM reports
       JOIN users ON users.id = reports.user_id
       LEFT JOIN sites ON sites.id = reports.site_id
       WHERE reports.org_id = ? ORDER BY reports.id DESC LIMIT 100`
    )
    .all(req.org);
  rows.forEach((r) => {
    r.recipients = db
      .prepare(
        `SELECT rr.user_id, users.name, rr.ack_at, rr.ack_comment FROM report_recipients rr
         JOIN users ON users.id = rr.user_id WHERE rr.report_id = ?`
      )
      .all(r.id);
  });
  res.json(rows);
});

app.post("/api/reports", auth, requireRole("owner", "lead", "tech"), async (req, res) => {
  const { title, body, to, site_id } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "A subject and message are required." });

  const save = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO reports (org_id, site_id, title, body, user_id, report_date) VALUES (?,?,?,?,?,date('now'))")
      .run(req.org, site_id || null, title.trim(), body, req.user.id);
    const ins = db.prepare("INSERT OR IGNORE INTO report_recipients (report_id, user_id) VALUES (?,?)");
    (Array.isArray(to) ? to : []).forEach((id) => {
      // recipients must be in the same organisation
      const ok = db.prepare("SELECT id FROM users WHERE id = ? AND org_id = ?").get(id, req.org);
      if (ok) ins.run(info.lastInsertRowid, Number(id));
    });
    return info.lastInsertRowid;
  });

  const id = save();
  const emails = db
    .prepare(
      `SELECT users.email FROM report_recipients rr JOIN users ON users.id = rr.user_id WHERE rr.report_id = ?`
    )
    .all(id)
    .map((r) => r.email);
  const mailed = await sendMail(emails, title, body, req.user.name).catch(() => false);
  res.json({ id, emailed: mailed, recipients: emails.length });
});

app.post("/api/reports/:id/ack", auth, (req, res) => {
  const own = db.prepare("SELECT id FROM reports WHERE id = ? AND org_id = ?").get(req.params.id, req.org);
  if (!own) return res.status(404).json({ error: "No such update." });
  const info = db
    .prepare(
      `UPDATE report_recipients SET ack_at = datetime('now'), ack_comment = ?
       WHERE report_id = ? AND user_id = ? AND ack_at IS NULL`
    )
    .run((req.body && req.body.comment) || "", req.params.id, req.user.id);
  if (!info.changes)
    return res.status(400).json({ error: "This wasn't sent to you, or you already acknowledged it." });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- */
/*  Exports                                                          */
/* ---------------------------------------------------------------- */

function csv(res, filename, head, rows) {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const body = [head.join(",")].concat(rows.map((r) => Object.values(r).map(esc).join(","))).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

app.get("/api/export/logs.csv", auth, (req, res) =>
  csv(res, "field-log.csv",
    ["Date", "Site", "Type", "Logged by", "Work", "Crew", "Hours", "Severity", "Issue", "Resolved"],
    db.prepare(
      `SELECT logs.entry_date, COALESCE(sites.name,'General') AS site, COALESCE(sites.site_type,'') AS type,
              users.name AS author, logs.work, logs.crew, logs.hours, logs.severity, logs.issue, logs.resolved
       FROM logs JOIN users ON users.id = logs.user_id LEFT JOIN sites ON sites.id = logs.site_id
       WHERE logs.org_id = ? ORDER BY logs.entry_date`
    ).all(req.org))
);

app.get("/api/export/readings.csv", auth, (req, res) =>
  csv(res, "readings.csv",
    ["Date", "Site", "Equipment", "Parameter", "Value", "Unit", "Out of range", "Taken by", "Note"],
    db.prepare(
      `SELECT readings.taken_on, sites.name AS site, COALESCE(equipment.name,'') AS equipment,
              readings.param, readings.value, readings.unit, readings.flagged, users.name AS author, readings.note
       FROM readings JOIN sites ON sites.id = readings.site_id JOIN users ON users.id = readings.user_id
       LEFT JOIN equipment ON equipment.id = readings.equipment_id
       WHERE readings.org_id = ? ORDER BY readings.taken_on`
    ).all(req.org))
);

app.get("/api/export/equipment.csv", auth, (req, res) =>
  csv(res, "equipment.csv",
    ["Site", "Equipment", "Make", "Model", "Serial", "Installed", "Last service", "Service interval (days)", "Calibration due"],
    db.prepare(
      `SELECT sites.name AS site, equipment.name, equipment.make, equipment.model, equipment.serial,
              equipment.installed_on, equipment.last_service, equipment.service_days, equipment.calibration_due
       FROM equipment JOIN sites ON sites.id = equipment.site_id
       WHERE equipment.org_id = ? ORDER BY sites.name, equipment.name`
    ).all(req.org))
);

/* ---------------------------------------------------------------- */
/*  Optional email                                                   */
/* ---------------------------------------------------------------- */

let transport = null;
async function sendMail(emails, subject, body, from) {
  if (!emails.length || !process.env.SMTP_HOST) return false;
  const nodemailer = require("nodemailer");
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE) === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: emails.join(","),
    subject,
    text: `${body}\n\n—\nSent from FieldTrack by ${from}.`,
  });
  return true;
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something broke on the server. Try again." });
});

app.listen(PORT, () => {
  const nets = require("os").networkInterfaces();
  const lan = [];
  Object.values(nets).forEach((ifaces) =>
    (ifaces || []).forEach((n) => n.family === "IPv4" && !n.internal && lan.push(n.address))
  );
  console.log("\n  FieldTrack is running.\n");
  console.log(`  On this machine:       http://localhost:${PORT}`);
  lan.forEach((ip) => console.log(`  On phones (same wifi): http://${ip}:${PORT}`));
  console.log("");
});
