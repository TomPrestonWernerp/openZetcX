import fs from "fs";
import path from "path";
import YAML from "js-yaml";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(root, "skills2set");
const expectedSkills = [
  "emergency-plan-auditor",
  "enterprise-emergency-plan-generator",
  "risk-assessment-report-compiler",
  "resource-investigation-compiler",
];

describe("bundled environmental emergency skills", () => {
  it.each(expectedSkills)("%s has a valid, folder-matching SKILL.md", (skillName) => {
    const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
    const source = fs.readFileSync(skillPath, "utf-8");
    const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);

    expect(frontmatterMatch).not.toBeNull();
    const metadata = YAML.load(frontmatterMatch![1]) as {
      name?: string;
      description?: string;
    };
    expect(metadata.name).toBe(skillName);
    expect(metadata.description?.trim().length).toBeGreaterThan(10);
    expect(source).toContain("三书");
  });

  it("does not bundle archive metadata or macOS resource-fork files", () => {
    const unwanted = fs.readdirSync(skillsRoot, { recursive: true })
      .map(String)
      .filter((entry) => (
        entry.includes("__MACOSX")
        || path.basename(entry).startsWith("._")
        || path.basename(entry) === "_meta.json"
      ));

    expect(unwanted).toEqual([]);
  });
});
