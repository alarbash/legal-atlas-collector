import "dotenv/config";
import { ArchiveOrgCollector } from "~/collectors/archive";

// https://archive.org/details/kuwaitalyawm

describe("Archive.org integration", () => {
  it("should fetch metadata using ArchiveOrgCollector", async () => {
    const collector = new ArchiveOrgCollector();
    const files = await collector.fetchFiles(
      "https://archive.org/details/kuwaitalyawm",
    );

    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });
});
