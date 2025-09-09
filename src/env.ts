import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});
type Env = z.infer<typeof envSchema>;
let env: Env;

// Skip validation if SKIP_ENV_VALIDATION is set
if (process.env.SKIP_ENV_VALIDATION === "1") {
  env = {
    NODE_ENV: (process.env.NODE_ENV as Env["NODE_ENV"] | undefined) ?? "development",
    // ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    DATABASE_URL: process.env.DATABASE_URL!,
  };
} else {
  try {
    env = envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error("Invalid server environment variables");
    }
    throw error;
  }
}

export { env };
