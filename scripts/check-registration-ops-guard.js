const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertContains(file, needle) {
  const source = read(file);
  if (!source.includes(needle)) {
    throw new Error(`${file} is missing required guard: ${needle}`);
  }
}

function main() {
  const required = [
    ["functions/index.js", "REGISTRATION_CALLABLE_NAMES"],
    ["functions/index.js", "REGISTRATION_ERROR_LOG_CONTEXTS"],
    ["functions/index.js", "checkRegistrationCallableHealth"],
    ["functions/index.js", "exports.watchRegistrationCallableHealth"],
    ["functions/index.js", "exports.registrationSyntheticSmoke"],
    ["functions/index.js", "exports.runRegistrationSyntheticSmoke"],
    ["functions/index.js", "opsMonitorState"],
    ["functions/index.js", "opsMonitorConfig"],
    [".github/workflows/test.yml", "npm run check:registration-ops"],
    [".github/workflows/deploy-functions.yml", "firebase deploy --only functions --project fc-football-6c8dc"],
    [".github/workflows/deploy-functions.yml", "npm run check:registration-ops"],
  ];

  required.forEach(([file, needle]) => assertContains(file, needle));
  console.log("registration ops guard: OK");
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
