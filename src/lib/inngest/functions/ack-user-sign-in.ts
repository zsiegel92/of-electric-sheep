import { inngest, userSignedIn } from "@/lib/inngest/inngest";

export const ackUserSignIn = inngest.createFunction(
  { id: "ack-user-sign-in", triggers: [userSignedIn] },
  ({ event }) => ({ githubId: event.data.githubId }),
);
