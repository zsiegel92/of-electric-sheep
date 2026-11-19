import "@tanstack/react-start/server-only";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { inngest, userSignedIn } from "../lib/inngest/inngest";
import { zodUserSchemaToBetterAuthUserSpec } from "./zod-user-spec";

const envSchema = z.object({
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:5173"),
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
    // Provider-mapped claims can be supplied at sign-in, but cannot be edited.
    disabledPaths: ["/update-user"],
    user: zodUserSchemaToBetterAuthUserSpec(userSchema),
    hooks: {
      after: createAuthMiddleware(async ({ path, context }) => {
        if (path !== "/callback/:id" || !context.newSession) return;

        try {
          const { githubId } = userSchema.parse(context.newSession.user);
          await inngest.send(userSignedIn.create({ githubId }));
        } catch (error) {
          console.error("Could not publish auth/user.signed-in", error);
        }
      }),
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
