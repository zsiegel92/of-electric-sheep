export const systemOnePath = "/system-one";
export const systemOneModelsPath = "/system-one/models";

export function isSystemOneRequest(path: string) {
  const pathname = path.replace(/\/$/, "");
  return (
    pathname === `/api${systemOnePath}` ||
    pathname === `/api${systemOneModelsPath}`
  );
}
