import * as api from "@/generated/sdk.gen";
import type { ApiKeyName } from "@/generated/types.gen";
import { readApi } from "./http";

export const listApiKeys = () => readApi(api.listApiKeys());

export function createApiKey({ data }: { data: ApiKeyName }) {
  return readApi(api.createApiKey({ body: data }));
}

export function revokeApiKey({ data }: { data: { id: string } }) {
  return readApi(api.revokeApiKey({ path: { key_id: data.id } }));
}
