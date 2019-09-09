import fs from "fs";
import path from "path";

export const getFragment = name =>
  fs.readFileSync(
    path.resolve(__dirname, `../fragments/${name}.graphql`),
    "utf8"
  );
