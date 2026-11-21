export function buildCurl(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  stateFromFile: boolean,
) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const json = quote(JSON.stringify(body, null, 2));
  // End the single-quoted JSON briefly so the shell expands the file as a JSON string.
  const payload = stateFromFile
    ? json.replace(
        /^ {2}"state": "<state>"(?=,?$)/m,
        () => `  "state": '"$(jq -Rs . < '<filepath>')"'`,
      )
    : json;
  return [
    `curl --request POST ${quote(url)}`,
    ...Object.entries({ "Content-Type": "application/json", ...headers }).map(
      ([name, value]) => `  --header ${quote(`${name}: ${value}`)}`,
    ),
    `  --data-binary ${payload}`,
  ].join(" \\\n");
}
