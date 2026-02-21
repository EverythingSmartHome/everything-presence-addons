import fs from "fs";
import os from "os";
import path from "path";

// Set DATA_DIR to an isolated temp directory BEFORE any app module is imported.
// storage.ts and deviceMappingStorage.ts resolve DATA_DIR at module load time,
// so this must happen first.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ep-test-"));
process.env.DATA_DIR = tmpDir;
