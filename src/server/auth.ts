import "@tanstack/react-start/server-only";
import { betterAuth } from "better-auth";
import { z } from "zod";

const envSchema = z.object({
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.httpUrl().default("http://localhost:5173"),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
});

export const userSchema = z.object({
  name: z.string(),
  email: z.email(),
  githubId: z.string(),
});

export type User = z.infer<typeof userSchema>;

const githubProfile = z.object({ id: z.int().positive() });

function createAuth() {
  const env = envSchema.parse(process.env);
  return betterAuth({
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    advanced: {
      cookiePrefix: "sheep-start",
      useSecureCookies: new URL(env.APP_URL).protocol === "https:",
    },
    account: { storeStateStrategy: "cookie", storeAccountCookie: false },
    session: {
      expiresIn: 3600,
      cookieCache: {
        enabled: true,
        maxAge: 3600,
        strategy: "jwt",
        refreshCache: false,
      },
    },
    user: {
      additionalFields: { githubId: { type: "string", required: true } },
    },
    socialProviders:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
              mapProfileToUser(profile) {
                return { githubId: String(githubProfile.parse(profile).id) };
              },
            },
          }
        : {},
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  instance ??= createAuth();
  return instance;
}

export async function getUser(headers: Headers): Promise<User | null> {
  const session = await getAuth().api.getSession({ headers });
  return session ? userSchema.parse(session.user) : null;
}

export function requireUser(user: User | null): User {
  if (!user) {
    throw new Error("Sign in required");
  }
  return user;
}
