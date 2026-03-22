import fs from "node:fs";
import path from "node:path";

// Configurable allowed directory — all file I/O must resolve inside this directory.
// Defaults to the current working directory. Override via setAllowedDirectory().
let allowedDirectory: string = process.cwd();

export function setAllowedDirectory(dir: string): void {
  allowedDirectory = path.resolve(dir);
}

export function getAllowedDirectory(): string {
  return allowedDirectory;
}

function assertSafePath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const allowedDir = allowedDirectory.endsWith(path.sep)
    ? allowedDirectory
    : allowedDirectory + path.sep;

  // Check that the resolved path is within the allowed directory
  if (!resolved.startsWith(allowedDir) && resolved !== allowedDirectory) {
    throw new Error(`Path blocked: ${filePath} is outside the allowed directory (${allowedDirectory})`);
  }

  // Reject symlinks — check if the path exists and is a symlink
  try {
    const lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Path blocked: ${filePath} is a symbolic link`);
    }
  } catch (err: unknown) {
    // If the file doesn't exist yet (output file), check parent directory exists
    // and is not a symlink
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      const parentDir = path.dirname(resolved);
      try {
        const parentStat = fs.lstatSync(parentDir);
        if (parentStat.isSymbolicLink()) {
          throw new Error(`Path blocked: parent directory of ${filePath} is a symbolic link`);
        }
      } catch {
        // Parent doesn't exist — will fail at read/write time naturally
      }
    } else {
      throw err;
    }
  }
}

export function csvToJson(inputPath: string, outputPath: string): void {
  assertSafePath(inputPath);
  assertSafePath(outputPath);
  const raw = fs.readFileSync(inputPath, "utf8").trimEnd();
  const lines = raw.split("\n");

  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  // Simple comma-split parser — does NOT handle quoted fields.
  // Reject input that contains quoted fields rather than silently producing wrong output.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('"')) {
      throw new Error(
        `CSV contains quoted fields (line ${i + 1}). This parser does not support quoted fields — use a CSV without quotes.`,
      );
    }
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = values[i] ?? "";
    }
    return obj;
  });

  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2) + "\n", "utf8");
}
