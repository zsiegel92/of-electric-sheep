import { z } from "zod";

export const apiKeyHeader = "X-API-Key";
export const apiKeySecret = z.string().regex(/^oes_[\w-]{43}$/);
