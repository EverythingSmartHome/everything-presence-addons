import fs from "fs";

/**
 * Delete all files inside DATA_DIR so the next test starts with clean storage.
 * Leaves the directory itself intact (storage.ts will re-create files as needed).
 */
export function resetStorage(): void {
	const dir = process.env.DATA_DIR;
	if (!dir) return;

	if (fs.existsSync(dir)) {
		for (const entry of fs.readdirSync(dir)) {
			const fullPath = `${dir}/${entry}`;
			const stat = fs.statSync(fullPath);
			if (stat.isDirectory()) {
				fs.rmSync(fullPath, { recursive: true, force: true });
			} else {
				fs.unlinkSync(fullPath);
			}
		}
	}
}
