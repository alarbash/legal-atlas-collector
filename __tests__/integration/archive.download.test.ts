import "dotenv/config";
import { ArchiveOrgCollector } from "~/collectors/archive";
import { existsSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";

describe("Archive.org file download", () => {
  it("should download the first PDF file", async () => {
    const collector = new ArchiveOrgCollector();
    const testOutputDir = join(__dirname, "temp-downloads");

    // Create temp directory
    if (!existsSync(testOutputDir)) {
      mkdirSync(testOutputDir, { recursive: true });
    }

    try {
      const archiveData = await collector.getArchiveData(
        "https://archive.org/details/kuwaitalyawm",
      );

      // Find first PDF file
      const pdfFile = archiveData.files.find(
        (file) => file.format === "Text PDF" && file.name.endsWith(".pdf"),
      );

      expect(pdfFile).toBeDefined();

      const outputPath = join(testOutputDir, pdfFile!.name);
      await collector.downloadFile(archiveData, pdfFile!.name, outputPath);

      // Verify file was downloaded
      expect(existsSync(outputPath)).toBe(true);
      const stats = statSync(outputPath);
      expect(stats.size).toBeGreaterThan(0);
    } finally {
      // Clean up
      if (existsSync(testOutputDir)) {
        rmSync(testOutputDir, { recursive: true, force: true });
      }
    }
  }, 30000);
});
