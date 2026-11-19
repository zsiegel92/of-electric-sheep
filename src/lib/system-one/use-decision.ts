import { useMutation } from "@tanstack/react-query";
import { decide, type SystemOneInput } from "./client";

export function useDecision(apiKey: string) {
  return useMutation({
    mutationFn: (input: SystemOneInput) => decide(input, { apiKey }),
  });
}
