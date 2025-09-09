import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import logger from "~/logger";

const app = express();
const PORT = process.env.PORT ?? 4500;

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

export default app;
