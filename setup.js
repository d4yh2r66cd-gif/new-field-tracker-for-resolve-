// Run once locally: creates .env with a strong secret.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) { console.log("\n  .env already exists — leaving it alone.\n"); process.exit(0); }
const env = fs.readFileSync(path.join(__dirname, ".env.example"), "utf8")
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(48).toString("hex")}`);
fs.writeFileSync(envPath, env);
console.log("\n  Setup complete. Start with: npm start");
console.log("  Then open http://localhost:3000 and set up your organisation.\n");
