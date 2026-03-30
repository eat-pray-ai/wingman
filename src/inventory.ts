import type { AgentSummary, PluginInfo, InventoryItem, Inventory } from "./types.js";

/**
 * Clean up a plugin name for display: strip version specifiers, git URLs, etc.
 * "oh-my-opencode@latest" → "oh-my-opencode"
 * "superpowers@git+https://github.com/obra/superpowers.git" → "superpowers"
 * "superpowers@marketplace" → "superpowers"
 */
export function cleanPluginName(raw: string): string {
  // Strip everything after @ (version, git URL, marketplace)
  const atIndex = raw.indexOf("@");
  return atIndex > 0 ? raw.slice(0, atIndex) : raw;
}

export function buildInventory(agents: AgentSummary[]): Inventory {
  // Merge plugins by name, collecting all skills/agents/commands and tracking sources
  const pluginMap = new Map<string, PluginInfo>();
  const mcpServerSources = new Map<string, Set<string>>();
  const skillSources = new Map<string, Set<string>>();
  const pluginBundledSkills = new Set<string>();

  for (const agent of agents) {
    // Track MCP server sources
    for (const s of agent.config.mcpServers) {
      if (!mcpServerSources.has(s)) mcpServerSources.set(s, new Set());
      mcpServerSources.get(s)!.add(agent.agent);
    }

    // Track standalone skill sources
    for (const s of agent.config.skills) {
      if (!skillSources.has(s)) skillSources.set(s, new Set());
      skillSources.get(s)!.add(agent.agent);
    }

    for (const plugin of agent.config.plugins) {
      const existing = pluginMap.get(plugin.name);
      if (existing) {
        if (!existing.sources.includes(agent.agent)) existing.sources.push(agent.agent);
        for (const s of plugin.skills) {
          if (!existing.skills.includes(s)) existing.skills.push(s);
        }
        for (const a of plugin.agents) {
          if (!existing.agents.includes(a)) existing.agents.push(a);
        }
        for (const c of plugin.commands) {
          if (!existing.commands.includes(c)) existing.commands.push(c);
        }
        if (!existing.version && plugin.version) existing.version = plugin.version;
      } else {
        pluginMap.set(plugin.name, {
          ...plugin,
          skills: [...plugin.skills],
          agents: [...plugin.agents],
          commands: [...plugin.commands],
          sources: [agent.agent],
        });
      }
    }
  }

  // Track what's bundled by plugins
  for (const plugin of pluginMap.values()) {
    for (const s of plugin.skills) pluginBundledSkills.add(s);
  }

  // Dangling = not bundled by any plugin
  const danglingMcp: InventoryItem[] = [...mcpServerSources.entries()]
    .map(([name, sources]) => ({ name, sources: [...sources] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const danglingSkills: InventoryItem[] = [...skillSources.entries()]
    .filter(([name]) => !pluginBundledSkills.has(name))
    .map(([name, sources]) => ({ name, sources: [...sources] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const plugins = [...pluginMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of plugins) {
    p.skills.sort();
    p.agents.sort();
    p.commands.sort();
  }

  return { plugins, mcpServers: danglingMcp, skills: danglingSkills };
}
