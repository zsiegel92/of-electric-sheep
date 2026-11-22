import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ImageMagick 7 renders the favicon set from the editable navbar sprite.
const cwd = fileURLToPath(new URL("../public/", import.meta.url));

function resize(size: number, filename: string) {
  execFileSync(
    "magick",
    [
      "sheep.png",
      "-filter",
      "Lanczos",
      // Keep the fine outline and the gold marking distinct at tab size.
      "-define",
      `filter:blur=${size === 16 ? 0.67 : 1}`,
      "-resize",
      `${size}x${size}`,
      "-depth",
      "8",
      "-strip",
      filename,
    ],
    { cwd },
  );
}

const icons = [16, 32, 48].map((size) => {
  const filename = `favicon-${size}x${size}.png`;
  resize(size, filename);
  return filename;
});
resize(180, "apple-touch-icon.png");
execFileSync("magick", [...icons, "favicon.ico"], { cwd });
