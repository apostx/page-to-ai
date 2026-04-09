const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const version = manifest.version;
const outDir = "dist";
const stagingDir = path.join(outDir, "staging");
const zipName = `page-to-ai-v${version}.zip`;

// Files to include in the build (paths relative to project root)
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

// Verify all source files exist
const missing = include.filter((f) => !fs.existsSync(f));
if (missing.length) {
  console.error("Missing files:", missing.join(", "));
  process.exit(1);
}

// Clean staging dir
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// Copy each file into staging, preserving folder structure
for (const rel of include) {
  const src = rel;
  const dest = path.join(stagingDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const zipPath = path.join(outDir, zipName);

// Remove old zip if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Create a real zip using .NET's ZipArchive via PowerShell, adding entries
// explicitly with forward-slash paths (Chrome Web Store rejects backslashes,
// which .NET's CreateFromDirectory produces on Windows).
// Write the PS script to a temp file to avoid cmd.exe quoting issues.
const zipAbs = path.resolve(zipPath);

const psLines = [
  "Add-Type -AssemblyName System.IO.Compression",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  `$zip = [System.IO.Compression.ZipFile]::Open('${zipAbs.replace(/'/g, "''")}', 'Create')`,
];
for (const rel of include) {
  const src = path.resolve(stagingDir, rel).replace(/'/g, "''");
  const entryName = rel.replace(/\\/g, "/");
  psLines.push(
    `[void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, '${src}', '${entryName}', 'Optimal')`
  );
}
psLines.push("$zip.Dispose()");

const psFile = path.join(outDir, "_build.ps1");
fs.writeFileSync(psFile, psLines.join("\r\n"));

try {
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
    stdio: "inherit",
  });
} catch {
  // Fallback: zip command if available (Git Bash, Linux, macOS)
  try {
    const fileList = include.map((f) => `"${f.replace(/\\/g, "/")}"`).join(" ");
    execSync(`cd "${stagingDir}" && zip -r "${zipAbs}" ${fileList}`, {
      stdio: "inherit",
      shell: true,
    });
  } catch {
    console.error("Could not create zip. Install PowerShell or zip.");
    process.exit(1);
  }
} finally {
  if (fs.existsSync(psFile)) fs.unlinkSync(psFile);
}

// Clean up staging
fs.rmSync(stagingDir, { recursive: true, force: true });

const stats = fs.statSync(zipPath);
const sizeKB = (stats.size / 1024).toFixed(1);
console.log(`\nBuild complete: ${zipPath} (${sizeKB} KB)`);
