import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { csvToJson, setAllowedDirectory } from "../src/transform";
import { computeHash, verifyOutput } from "../src/verify";
import { TaskContractSchema } from "../src/contract";

describe("CSV edge cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-edge-"));
    setAllowedDirectory(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("completely empty file", () => {
    const input = path.join(tmpDir, "empty.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "", "utf8");
    expect(() => csvToJson(input, output)).toThrow();
  });

  it("single newline only", () => {
    const input = path.join(tmpDir, "newline.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "\n", "utf8");
    expect(() => csvToJson(input, output)).toThrow();
  });

  it("headers only, no data rows", () => {
    const input = path.join(tmpDir, "headers.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "name,age,city", "utf8");
    expect(() => csvToJson(input, output)).toThrow("header row and at least one data row");
  });

  it("one data row with fewer columns than headers", () => {
    const input = path.join(tmpDir, "short-row.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "name,age,city\nAlice", "utf8");
    csvToJson(input, output);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(result).toEqual([{ name: "Alice", age: "", city: "" }]);
  });

  it("one data row with more columns than headers", () => {
    const input = path.join(tmpDir, "long-row.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "name,age\nAlice,30,extra,bonus", "utf8");
    csvToJson(input, output);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    // Extra columns should be silently dropped (no header to map to)
    expect(result).toEqual([{ name: "Alice", age: "30" }]);
  });

  it("rejects CSV with quoted fields instead of silently corrupting", () => {
    const input = path.join(tmpDir, "embedded-comma.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, 'name,note\nAlice,"has a comma, here"', "utf8");
    expect(() => csvToJson(input, output)).toThrow("quoted fields");
  });

  it("Windows line endings (CRLF)", () => {
    const input = path.join(tmpDir, "crlf.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "name,age\r\nAlice,30\r\nBob,25", "utf8");
    csvToJson(input, output);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    // Check if CRLF is handled — \r may pollute values
    const ages = result.map((r: Record<string, string>) => r.age);
    expect(ages).toContain("30");
    expect(ages).toContain("25");
  });

  it("trailing empty lines", () => {
    const input = path.join(tmpDir, "trailing.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "name,age\nAlice,30\n\n\n", "utf8");
    csvToJson(input, output);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    // Should not produce empty/garbage rows from trailing newlines
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Alice");
  });

  it("unicode content", () => {
    const input = path.join(tmpDir, "unicode.csv");
    const output = path.join(tmpDir, "out.json");
    fs.writeFileSync(input, "name,city\nSakura,東京\nMüller,Zürich", "utf8");
    csvToJson(input, output);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(result[0].city).toBe("東京");
    expect(result[1].name).toBe("Müller");
  });

  it("very large number of columns", () => {
    const input = path.join(tmpDir, "wide.csv");
    const output = path.join(tmpDir, "out.json");
    const headers = Array.from({ length: 500 }, (_, i) => `col${i}`).join(",");
    const values = Array.from({ length: 500 }, (_, i) => `val${i}`).join(",");
    fs.writeFileSync(input, `${headers}\n${values}`, "utf8");
    csvToJson(input, output);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(Object.keys(result[0]).length).toBe(500);
  });
});

describe("verify edge cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-"));
    setAllowedDirectory(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hash of empty file", () => {
    const file = path.join(tmpDir, "empty.json");
    fs.writeFileSync(file, "", "utf8");
    const hash = computeHash(file);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("verifyOutput on nonexistent file throws", () => {
    expect(() => verifyOutput("/nonexistent/file.json", "sha256:0000000000000000000000000000000000000000000000000000000000000000")).toThrow();
  });

  it("hash is deterministic", () => {
    const file = path.join(tmpDir, "test.json");
    fs.writeFileSync(file, '{"a":1}\n', "utf8");
    const hash1 = computeHash(file);
    const hash2 = computeHash(file);
    expect(hash1).toBe(hash2);
  });
});

describe("path traversal attacks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-path-"));
    setAllowedDirectory(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("blocks /etc/passwd as input", () => {
    const output = path.join(tmpDir, "out.json");
    expect(() => csvToJson("/etc/passwd", output)).toThrow("Path blocked");
  });

  it("blocks /etc/shadow as output", () => {
    const input = path.join(tmpDir, "input.csv");
    fs.writeFileSync(input, "a,b\n1,2", "utf8");
    expect(() => csvToJson(input, "/etc/shadow")).toThrow("Path blocked");
  });

  it("blocks /usr/bin as output", () => {
    const input = path.join(tmpDir, "input.csv");
    fs.writeFileSync(input, "a,b\n1,2", "utf8");
    expect(() => csvToJson(input, "/usr/bin/evil")).toThrow("Path blocked");
  });

  it("blocks dot-dot traversal escaping allowed directory", () => {
    const input = path.join(tmpDir, "input.csv");
    fs.writeFileSync(input, "a,b\n1,2", "utf8");
    const escapedOutput = path.join(tmpDir, "..", "escaped.json");
    expect(() => csvToJson(input, escapedOutput)).toThrow("Path blocked");
  });

  it("blocks user home directory files", () => {
    const output = path.join(tmpDir, "out.json");
    expect(() => csvToJson(path.join(os.homedir(), ".ssh/id_rsa"), output)).toThrow("Path blocked");
  });
});

describe("contract validation edge cases", () => {
  const validContract = {
    task: "file-transform",
    transform_type: "csv-to-json",
    input_file: "in.csv",
    output_file: "out.json",
    bond_amount_cents: 100,
    ttl_seconds: 300,
    expected_output_hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  };

  it("rejects garbage JSON shape", () => {
    expect(TaskContractSchema.safeParse("just a string").success).toBe(false);
    expect(TaskContractSchema.safeParse(42).success).toBe(false);
    expect(TaskContractSchema.safeParse(null).success).toBe(false);
    expect(TaskContractSchema.safeParse(undefined).success).toBe(false);
    expect(TaskContractSchema.safeParse([]).success).toBe(false);
  });

  it("rejects zero bond amount", () => {
    expect(TaskContractSchema.safeParse({ ...validContract, bond_amount_cents: 0 }).success).toBe(false);
  });

  it("rejects zero TTL", () => {
    expect(TaskContractSchema.safeParse({ ...validContract, ttl_seconds: 0 }).success).toBe(false);
  });

  it("rejects float bond amount", () => {
    expect(TaskContractSchema.safeParse({ ...validContract, bond_amount_cents: 99.5 }).success).toBe(false);
  });

  it("rejects empty input_file", () => {
    expect(TaskContractSchema.safeParse({ ...validContract, input_file: "" }).success).toBe(false);
  });

  it("rejects empty output_file", () => {
    expect(TaskContractSchema.safeParse({ ...validContract, output_file: "" }).success).toBe(false);
  });

  it("rejects wrong transform_type", () => {
    expect(TaskContractSchema.safeParse({ ...validContract, transform_type: "json-to-csv" }).success).toBe(false);
  });

  it("rejects hash without sha256: prefix", () => {
    expect(TaskContractSchema.safeParse({ ...validContract, expected_output_hash: "abc123" }).success).toBe(false);
  });

  it("accepts extra fields (Zod strips them)", () => {
    const result = TaskContractSchema.safeParse({ ...validContract, extra: "field" });
    expect(result.success).toBe(true);
  });
});
