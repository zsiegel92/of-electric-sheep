import type { os } from "@orpc/server";

type Route = Parameters<typeof os.route>[0];
type SpecTransform = Extract<
  NonNullable<Route["spec"]>,
  (operation: never) => unknown
>;
type Operation = Parameters<SpecTransform>[0];

export type RouteRequestBody = NonNullable<Operation["requestBody"]>;

export function routeGroup<Procedure>(
  procedure: { route: (definition: Route) => Procedure },
  options: { tag: string; security?: Operation["security"] },
) {
  return ({
    requestBody,
    spec,
    ...definition
  }: Route & { requestBody?: RouteRequestBody }) =>
    procedure.route({
      ...definition,
      tags: [options.tag, ...(definition.tags ?? [])],
      spec: (generated) => ({
        ...(typeof spec === "function" ? spec(generated) : (spec ?? generated)),
        ...(requestBody === undefined ? {} : { requestBody }),
        ...(options.security === undefined
          ? {}
          : { security: options.security }),
      }),
    });
}
