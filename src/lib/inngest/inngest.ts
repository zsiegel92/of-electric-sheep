import { eventType, Inngest } from "inngest";
import { z } from "zod";

export const inngest = new Inngest({ id: "of-electric-sheep" });

export const userSignedIn = eventType("auth/user.signed-in", {
  schema: z.object({ githubId: z.string().min(1) }),
});
