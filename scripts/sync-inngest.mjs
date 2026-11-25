const apiKey = process.env.INNGEST_API_KEY;
if (!apiKey) {
  if (!process.argv.includes("--if-configured")) {
    throw new Error("Set INNGEST_API_KEY to sync the deployed Inngest app.");
  }
  process.stdout.write(
    "Sync the deployed /api/inngest endpoint in the Inngest dashboard, or set INNGEST_API_KEY and run make inngest-sync.\n",
  );
} else {
  const backend = process.env.SHEEP_DEPLOYED_BACKEND_URL;
  if (!backend) {
    throw new Error(
      "Set SHEEP_DEPLOYED_BACKEND_URL to the deployed backend origin.",
    );
  }
  const url = new URL("/api/inngest", backend);
  const response = await fetch(
    "https://api.inngest.com/v2/apps/of-electric-sheep/syncs",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Inngest app sync failed (HTTP ${response.status}): ${await response.text()}`,
    );
  }
  process.stdout.write(`Synced Inngest at ${url.href}\n`);
}
