import type { ThemeRenderer } from "../types.js";
import githubDark from "./github-dark/index.js";
import githubLight from "./github-light/index.js";
import onedark from "./onedark/index.js";

const themes = new Map<string, ThemeRenderer>([
  [githubDark.name, githubDark],
  [githubLight.name, githubLight],
  [onedark.name, onedark],
]);

export function getTheme(name: string): ThemeRenderer | undefined {
  return themes.get(name);
}

export function getAvailableThemes(): string[] {
  return [...themes.keys()];
}
