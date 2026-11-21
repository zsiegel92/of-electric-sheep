import { Prism } from "prism-react-renderer";
import { Fragment } from "react";

const colors: Record<string, string> = {
  property: "text-sky-800",
  string: "text-violet-700",
  number: "text-amber-700",
  boolean: "text-fuchsia-700",
  null: "text-fuchsia-700",
  punctuation: "text-muted-foreground",
};

export function JsonText({ text }: { text: string }) {
  const grammar = Prism.languages["json"];
  return grammar ? renderTokens(Prism.tokenize(text, grammar)) : text;
}

function renderTokens(
  tokens: string | ReturnType<typeof Prism.tokenize>,
): React.ReactNode {
  if (typeof tokens === "string") return tokens;
  let offset = 0;
  return tokens.map((token) => {
    const start = offset;
    if (typeof token === "string") {
      offset += token.length;
      return <Fragment key={start}>{token}</Fragment>;
    }
    offset += token.length;
    return (
      <span key={start} className={colors[token.type]}>
        {renderTokens(
          Array.isArray(token.content) ? token.content : [token.content],
        )}
      </span>
    );
  });
}
