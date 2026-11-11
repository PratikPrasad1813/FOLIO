// Registers a Node loader that maps the project's "@/" alias to ./src/.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./alias-hooks.mjs", import.meta.url));
