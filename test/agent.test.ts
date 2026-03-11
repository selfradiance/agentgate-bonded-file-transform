import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { csvToJson } from "../src/transform";
import { computeHash, verifyOutput } from "../src/verify";

describe("transform + verify", () => {
  let tmpDir: string;
  const sampleCsv = path.resolve("examples/sample-input.csv");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("happy path — transform produces correct hash", () => {
    const inputPath = path.join(tmpDir, "input.csv");
    const outputPath = path.join(tmpDir, "output.json");

    fs.copyFileSync(sampleCsv, inputPath);
    csvToJson(inputPath, outputPath);

    const hash = computeHash(outputPath);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(verifyOutput(outputPath, hash)).toBe(true);
  });

  it("failure path — wrong hash returns false", () => {
    const inputPath = path.join(tmpDir, "input.csv");
    const outputPath = path.join(tmpDir, "output.json");

    fs.copyFileSync(sampleCsv, inputPath);
    csvToJson(inputPath, outputPath);

    expect(verifyOutput(outputPath, "sha256:wrong")).toBe(false);
  });
});
