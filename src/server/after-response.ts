import type { ServerRequest } from "nitro/types";

/** Run work after Nitro's Node transport finishes sending the response. */
export function afterResponse(
  request: ServerRequest,
  callback: () => void | Promise<void>,
): void {
  request.runtime?.node?.res?.once("finish", () => {
    void Promise.resolve()
      .then(callback)
      .catch((error: unknown) => {
        console.error("After-response task failed", error);
      });
  });
}
