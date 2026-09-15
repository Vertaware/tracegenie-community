import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
const [command, directory] = process.argv.slice(2);
const files = ["database.dump", "uploads.tar", ".env"];
const hash = async (name) => {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(path.join(directory, name))) digest.update(chunk);
  return digest.digest("hex");
};
if (command === "create") {
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files: Object.fromEntries(await Promise.all(files.map(async name => [name,await hash(name)]))) }, null, 2));
} else if (command === "verify") {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || (await Promise.all(files.map(async name => manifest.files[name] !== await hash(name)))).some(Boolean)) throw new Error("Backup is incomplete or a checksum does not match.");
} else throw new Error("Expected create or verify.");
