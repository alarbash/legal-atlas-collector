import axios from "axios";
import logger from "~/logger";
import { z } from "zod";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { db } from "~/db";
import { v4 as uuidv4 } from "uuid";

// interface File {
//   name: string;
//   size: number;
// }

export class DuplicateError extends Error {
  public id?: string;
  
  constructor(message: string, id?: string) {
    super(message);
    this.name = "DuplicateError";
    this.id = id;
  }
}

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

const configSchema = z.object({
  url: z.string().url().refine((val) => {
    return /^https:\/\/archive\.org\/(details|metadata)\/[^/]+$/.test(val);
  }, "Invalid Archive.org URL"),
}).strict();

type Config = z.infer<typeof configSchema>;

export class ArchiveOrgCollector {
  baseUrl = "https://archive.org";
  validUrlRegex = /^https:\/\/archive\.org\/(details|metadata)\/[^/]+$/;
  axiosInstance = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  public validateConfig(config: unknown): Config | null {
    const parsed = configSchema.safeParse(config);
    return parsed.success ? parsed.data : null;
  }

  public async createSource(config: unknown) {
    const parsedConfig = this.validateConfig(config);
    if (!parsedConfig) {
      throw new Error("Invalid configuration for archive.org files");
    }

    const exists = await db.documentSource.findFirst({
      where: {
        type: "archive.org files",
        config: {
          path: ["url"],
          equals: parsedConfig.url,
        },
      },
    });

    if (exists) {
      throw new DuplicateError("Data source already exists", exists.id);
    }

    const newSource = await db.documentSource.create({
      data: {
        type: "archive.org files",
        config: parsedConfig,
      },
    });

    return newSource;
  }

  private getIdentifierFromUrl(url: string): string | null {
    const match = url.match(/https:\/\/archive\.org\/details\/([^/]+)/);
    return match ? match[1] : null;
  }

  async fetchFiles(config: unknown): Promise<File[]> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(`Invalid configuration: ${parsed.error.message}`);
    }

    const { url } = parsed.data;
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

  async downloadFiles(
    sourceId: string,
    config: unknown,
    outputDir: string,
    fileFilter?: (file: File) => boolean,
  ): Promise<{ successful: string[]; failed: string[] }> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(`Invalid configuration: ${parsed.error.message}`);
    }

    const { url } = parsed.data;
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
      const fileName = `${uuidv4()}.${file.name.split('.').pop()}`;
      const outputPath = `${outputDir}/${fileName}`;

      let documentId: string | null = null;

      try {
        logger.debug(
          `Downloading file ${successful.length + failed.length + 1}/${files.length}`,
          {
            fileName: file.name,
            fileSize: file.size,
            format: file.format,
          },
        );

        const document = await db.document.create({
          data: {
            sourceId: sourceId,
            path: outputPath,
            status: "DOWNLOADING",
          }
        })

        documentId = document.id;

        await this.downloadFile(archiveData, file.name, outputPath);
        successful.push(outputPath);

        logger.debug("File downloaded successfully", {
          fileName: file.name,
          outputPath,
        });

        await db.document.update({
          where: { id: documentId },
          data: { status: "READY" },
        })
      } catch (error) {
        await db.document.update({
          where: { id: documentId! },
          data: { status: "ERROR" },
        })

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
