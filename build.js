const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const version = manifest.version;
const outDir = "dist";
const zipName = `page-to-ai-v${version}.zip`;

// Files to include in the build
const include = [
  "manifest.json",
  "background.js",
  "profiles.js",
  "content-extract.js",
  "content-attach.js",
  "content-picker.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "options.html",
  "options.js",
  "options.css",
  "lib/Readability.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// Ensure dist directory exists
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir);
}

// Verify all files exist
const missing = include.filter((f) => !fs.existsSync(f));
if (missing.length) {
  console.error("Missing files:", missing.join(", "));
  process.exit(1);
}

// Create zip using tar (available in Git Bash on Windows)
const filelist = include.join(" ");
const zipPath = path.join(outDir, zipName);

// Remove old zip if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

try {
  // Try PowerShell's Compress-Archive (works on Windows without extra tools)
  const psFiles = include.map((f) => `'${f}'`).join(",");
  execSync(
    `powershell -Command "Compress-Archive -Path ${psFiles} -DestinationPath '${zipPath}'"`,
    { stdio: "inherit" }
  );
} catch {
  // Fallback: try zip command
  try {
    execSync(`zip -r "${zipPath}" ${filelist}`, { stdio: "inherit" });
  } catch {
    console.error("Could not create zip. Install zip or use PowerShell.");
    process.exit(1);
  }
}

const stats = fs.statSync(zipPath);
const sizeKB = (stats.size / 1024).toFixed(1);
console.log(`\nBuild complete: ${zipPath} (${sizeKB} KB)`);
