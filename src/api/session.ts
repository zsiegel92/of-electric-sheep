import * as api from "@/generated/sdk.gen";
import { readApi } from "./http";

export async function getCurrentUser() {
  const result = await api.getCurrentUser();
  return result.response?.status === 401
    ? null
    : readApi(Promise.resolve(result));
}
