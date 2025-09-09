import axios from "axios";
import logger from "~/logger";
import { z } from "zod";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

// interface File {
//   name: string;
//   size: number;
// }

const fileSchema = z.object({
  name: z.string(),
  source: z.string().optional(),
  mtime: z.string().optional(),
  size: z
    .union([z.string(), z.number()])
    .transform((val) => (typeof val === "string" ? parseInt(val, 10) : val))
    .optional(),
  md5: z.string().optional(),
  crc32: z.string().optional(),
  sha1: z.string().optional(),
  format: z.string(),
  viruscheck: z.string().optional(),
  btih: z.string().optional(), // For torrent files
  summation: z.string().optional(), // For XML files
});

const metadataSchema = z.object({
  identifier: z.string(),
  mediatype: z.string(),
  collection: z.array(z.string()),
  description: z.string().optional(),
  scanner: z.string().optional(),
  subject: z.string().optional(),
  title: z.string(),
  uploader: z.string(),
  publicdate: z.string(),
  addeddate: z.string(),
  curation: z.string().optional(),
});

const archiveResponseSchema = z.object({
  alternate_locations: z
    .object({
      servers: z.array(
        z.object({
          server: z.string(),
          dir: z.string(),
        }),
      ),
      workable: z.array(
        z.object({
          server: z.string(),
          dir: z.string(),
        }),
      ),
    })
    .optional(),
  created: z.number(),
  d1: z.string(),
  d2: z.string(),
  dir: z.string(),
  files: z.array(fileSchema),
  files_count: z.number(),
  item_last_updated: z.number(),
  item_size: z.number(),
  metadata: metadataSchema,
  server: z.string(),
  uniq: z.number(),
  workable_servers: z.array(z.string()),
});

export type File = z.infer<typeof fileSchema>;
export type ArchiveResponse = z.infer<typeof archiveResponseSchema>;

export class ArchiveOrgCollector {
  baseUrl = "https://archive.org";
  axiosInstance = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  private getIdentifierFromUrl(url: string): string | null {
    const match = url.match(/https:\/\/archive\.org\/details\/([^/]+)/);
    return match ? match[1] : null;
  }

  async fetchFiles(url: string): Promise<File[]> {
    const response = await this.getArchiveData(url);
    return response.files;
  }

  async getArchiveData(url: string): Promise<ArchiveResponse> {
    // check if it matches https://archive.org/details/kuwaitalyawm then take the identifier part
    const match = this.getIdentifierFromUrl(url);

    if (!match) {
      throw new Error("Invalid Archive.org URL");
    }

    try {
      const response = await this.axiosInstance.get(`/metadata/${match}`);

      // Validate the entire response structure
      const parsed = archiveResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        logger.error("Invalid response structure from Archive.org", {
          errors: parsed.error.errors,
          url,
        });
        throw new Error("Invalid response structure from Archive.org");
      }

      return parsed.data;
    } catch (error) {
      logger.error("Error fetching metadata from Archive.org", {
        error: error instanceof Error ? error.message : String(error),
        url,
      });
      throw new Error("Failed to fetch metadata from Archive.org");
    }
  }

  getDownloadUrl(archiveData: ArchiveResponse, fileName: string): string {
    return `https://${archiveData.server}${archiveData.dir}/${fileName}`;
  }

  async downloadFile(
    archiveData: ArchiveResponse,
    fileName: string,
    outputPath: string,
  ): Promise<void> {
    const downloadUrl = this.getDownloadUrl(archiveData, fileName);

    try {
      logger.info("Starting file download", {
        fileName,
        downloadUrl,
        outputPath,
      });

      const response = await axios.get(downloadUrl, {
        responseType: "stream",
        timeout: 30000, // 30 second timeout
      });

      const writeStream = createWriteStream(outputPath);
      await pipeline(response.data, writeStream);

      logger.info("File download completed", {
        fileName,
        outputPath,
      });
    } catch (error) {
      logger.error("Error downloading file", {
        error: error instanceof Error ? error.message : String(error),
        fileName,
        downloadUrl,
        outputPath,
      });
      throw new Error(`Failed to download file: ${fileName}`);
    }
  }

  async downloadMultipleFiles(
    url: string,
    fileFilter: (file: File) => boolean,
    outputDir: string,
  ): Promise<string[]> {
    const archiveData = await this.getArchiveData(url);
    const filesToDownload = archiveData.files.filter(fileFilter);
    const downloadedFiles: string[] = [];

    logger.info("Starting batch download", {
      totalFiles: filesToDownload.length,
      outputDir,
    });

    for (const file of filesToDownload) {
      const outputPath = `${outputDir}/${file.name}`;
      try {
        await this.downloadFile(archiveData, file.name, outputPath);
        downloadedFiles.push(outputPath);
      } catch (error) {
        logger.error("Failed to download file in batch", {
          fileName: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other files instead of failing the entire batch
      }
    }

    logger.info("Batch download completed", {
      totalFiles: filesToDownload.length,
      successfulDownloads: downloadedFiles.length,
      failedDownloads: filesToDownload.length - downloadedFiles.length,
    });

    return downloadedFiles;
  }

  async downloadFilesFromUrl(
    url: string,
    outputDir: string,
    fileFilter?: (file: File) => boolean,
  ): Promise<{ successful: string[]; failed: string[] }> {
    const archiveData = await this.getArchiveData(url);
    const files = fileFilter
      ? archiveData.files.filter(fileFilter)
      : archiveData.files;

    const successful: string[] = [];
    const failed: string[] = [];

    logger.info("Starting individual file downloads", {
      totalFiles: files.length,
      outputDir,
    });

    for (const file of files) {
      const outputPath = `${outputDir}/${file.name}`;

      try {
        logger.info(
          `Downloading file ${successful.length + failed.length + 1}/${files.length}`,
          {
            fileName: file.name,
            fileSize: file.size,
            format: file.format,
          },
        );

        await this.downloadFile(archiveData, file.name, outputPath);
        successful.push(outputPath);

        logger.info("File downloaded successfully", {
          fileName: file.name,
          outputPath,
        });
      } catch (error) {
        failed.push(file.name);
        logger.error("Failed to download file", {
          fileName: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("All file downloads completed", {
      totalFiles: files.length,
      successful: successful.length,
      failed: failed.length,
      successfulFiles: successful,
      failedFiles: failed,
    });

    return { successful, failed };
  }
}
