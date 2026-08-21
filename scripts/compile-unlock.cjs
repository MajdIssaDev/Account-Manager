const { existsSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

const root = join(__dirname, "..");
const src = join(root, "build", "roblox-unlock.cs");
const out = join(root, "build", "roblox-unlock.exe");
const csc = join(
  process.env.WINDIR || "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);

if (!existsSync(src)) {
  console.error("Missing " + src);
  process.exit(1);
}

if (!existsSync(csc)) {
  console.error("csc.exe not found at " + csc);
  process.exit(1);
}

const result = spawnSync(
  csc,
  ["/nologo", "/optimize", "/platform:x64", "/target:exe", "/out:" + out, src],
  { encoding: "utf8" },
);
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
if (result.status !== 0 || !existsSync(out)) {
  console.error("Failed to compile roblox-unlock.exe");
  process.exit(result.status || 1);
}

console.log("Compiled " + out);
