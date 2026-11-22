import "@tanstack/react-start/server-only";

export function getObservabilityUrl(
  traceId: string,
  projectId = process.env["LANGFUSE_PROJECT_ID"]?.trim(),
  baseUrl = process.env["LANGFUSE_BASE_URL"] || "https://cloud.langfuse.com",
) {
  if (!projectId) return;
  const base = URL.parse(baseUrl);
  if (!base || !["https:", "http:"].includes(base.protocol)) return;
  base.pathname = `${base.pathname.replace(/\/$/, "")}/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
  base.search = new URLSearchParams({ traceId }).toString();
  base.hash = "";
  return base.href;
}
