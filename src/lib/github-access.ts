import "@tanstack/react-start/server-only";
import { z } from "zod";

export function isAllowedGitHubUser(githubId: string): boolean {
  const allowedIds = (process.env["ALLOWED_GITHUB_USER_IDS"] ?? "")
    .split(",")
    .map((id) => id.trim());
  return githubId.length > 0 && allowedIds.includes(githubId);
}

export const authorizedGitHubId = z.string().refine(isAllowedGitHubUser);
