import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { csvToJson, setAllowedDirectory } from "../src/transform";
import { computeHash, verifyOutput } from "../src/verify";
import { TaskContractSchema } from "../src/contract";

describe("transform + verify", () => {
  let tmpDir: string;
  const sampleCsv = path.resolve("examples/sample-input.csv");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
    setAllowedDirectory(tmpDir);
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

    expect(verifyOutput(outputPath, "sha256:0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
  });

  it("rejects empty CSV (no data rows)", () => {
    const inputPath = path.join(tmpDir, "empty.csv");
    const outputPath = path.join(tmpDir, "output.json");

    fs.writeFileSync(inputPath, "name,age\n", "utf8");
    expect(() => csvToJson(inputPath, outputPath)).toThrow("header row and at least one data row");
  });

  it("rejects header-only CSV", () => {
    const inputPath = path.join(tmpDir, "header-only.csv");
    const outputPath = path.join(tmpDir, "output.json");

    fs.writeFileSync(inputPath, "name,age", "utf8");
    expect(() => csvToJson(inputPath, outputPath)).toThrow("header row and at least one data row");
  });

  it("throws on missing input file", () => {
    const outputPath = path.join(tmpDir, "output.json");
    const missingPath = path.join(tmpDir, "nonexistent.csv");
    expect(() => csvToJson(missingPath, outputPath)).toThrow();
  });

  it("blocks path traversal to system directories", () => {
    const outputPath = path.join(tmpDir, "output.json");
    expect(() => csvToJson("/etc/passwd", outputPath)).toThrow("Path blocked");
  });

  it("blocks paths outside allowed directory", () => {
    const outputPath = path.join(tmpDir, "output.json");
    expect(() => csvToJson("/tmp/some-other-place/file.csv", outputPath)).toThrow("Path blocked");
  });

  it("blocks symlinks", () => {
    const inputPath = path.join(tmpDir, "input.csv");
    const symlinkPath = path.join(tmpDir, "link.csv");
    const outputPath = path.join(tmpDir, "output.json");
    fs.writeFileSync(inputPath, "name,age\nAlice,30", "utf8");
    fs.symlinkSync(inputPath, symlinkPath);
    expect(() => csvToJson(symlinkPath, outputPath)).toThrow("symbolic link");
  });
});

describe("contract validation", () => {
  it("accepts a valid contract", () => {
    const result = TaskContractSchema.safeParse({
      task: "file-transform",
      transform_type: "csv-to-json",
      input_file: "examples/sample-input.csv",
      output_file: "examples/sample-output.json",
      bond_amount_cents: 100,
      ttl_seconds: 300,
      expected_output_hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing fields", () => {
    const result = TaskContractSchema.safeParse({ task: "file-transform" });
    expect(result.success).toBe(false);
  });

  it("rejects wrong task type", () => {
    const result = TaskContractSchema.safeParse({
      task: "wrong-task",
      transform_type: "csv-to-json",
      input_file: "in.csv",
      output_file: "out.json",
      bond_amount_cents: 100,
      ttl_seconds: 300,
      expected_output_hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hash prefix", () => {
    const result = TaskContractSchema.safeParse({
      task: "file-transform",
      transform_type: "csv-to-json",
      input_file: "in.csv",
      output_file: "out.json",
      bond_amount_cents: 100,
      ttl_seconds: 300,
      expected_output_hash: "md5:abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short hash (not 64 hex chars)", () => {
    const result = TaskContractSchema.safeParse({
      task: "file-transform",
      transform_type: "csv-to-json",
      input_file: "in.csv",
      output_file: "out.json",
      bond_amount_cents: 100,
      ttl_seconds: 300,
      expected_output_hash: "sha256:abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative bond amount", () => {
    const result = TaskContractSchema.safeParse({
      task: "file-transform",
      transform_type: "csv-to-json",
      input_file: "in.csv",
      output_file: "out.json",
      bond_amount_cents: -100,
      ttl_seconds: 300,
      expected_output_hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(result.success).toBe(false);
  });
});
