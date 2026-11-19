import "@tanstack/react-start/server-only";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  type LangfuseGeneration,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";

function configureLangfuse() {
  const { LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY } = process.env;
  if (!LANGFUSE_PUBLIC_KEY?.trim() || !LANGFUSE_SECRET_KEY?.trim()) return;

  const processor = new LangfuseSpanProcessor({
    exportMode: "immediate",
    timeout: 2,
  });
  setLangfuseTracerProvider(
    new BasicTracerProvider({ spanProcessors: [processor] }),
  );
  return processor;
}

const processor = configureLangfuse();

export async function traceGeneration<T>(
  name: string,
  run: (generation?: LangfuseGeneration) => Promise<T>,
): Promise<T> {
  if (!processor) return run();

  const generation = startObservation(name, {}, { asType: "generation" });
  try {
    return await run(generation);
  } catch (error) {
    generation.update({ level: "ERROR", statusMessage: "Decision failed" });
    throw error;
  } finally {
    generation.end();
    try {
      await processor.forceFlush();
    } catch {
      console.warn("Could not flush Langfuse traces");
    }
  }
}
