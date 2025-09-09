import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import logger from "~/logger";
import { db } from "./db";
import {z} from "zod";
import { ArchiveOrgCollector, DuplicateError } from "./collectors/archive";

const app = express();
const PORT = process.env.PORT ?? 4500;

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const idSchema = z.string().uuid();

app.post("/datasource/create", async (req, res) => {
  const bodySchema = z.object({
    type: z.enum(["archive.org files"]),
    config: z.unknown(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors });
  }

  const { type, config } = parsed.data;
  
  // Validate config based on type
  if (type === "archive.org files") {
    const collector = new ArchiveOrgCollector();
    
    try {
      const newSource = await collector.createSource(config);
      return res.status(201).json(newSource);
    } catch (error) {
      if (error instanceof DuplicateError){
        return res.status(409).json({ error: error.message, id: error.id });
      }
      
      logger.error("Error creating data source", {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  } else {
    return res.status(400).json({ error: "Unsupported data source type" });
  }
});

app.post("/task/datasource/:id", async (req, res) => {
  const { id: rawId } = req.params;
  
  const {data: id, success} = idSchema.safeParse(rawId);
  if (!success) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  const source = await db.documentSource.findUnique({
    where: { id: id },
  });

  if (!source) {
    return res.status(404).json({ error: "Data source not found" });
  }

  if (source.type === "archive.org files") {
    const collector = new ArchiveOrgCollector()

    const config = source.config;

    await collector.downloadFiles(
      source.id,
      config,
      "./downloads",
      (file) => file.name.endsWith(".pdf") || file.name.endsWith(".txt")
    );

    return res.status(200).json({ message: "Download task finished" });
  }
});

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

export default app;
