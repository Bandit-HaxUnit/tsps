// The ::serverperf and ::pluginperf numbers, returned as data instead of chat lines.
module.exports = function registerPerfTools(ctx) {
  const { core, tool, z } = ctx;
  const { ServerPerf, PluginPerf } = core;
  const ms = (value) => Math.round(value * 1000) / 1000;

  tool(
    "server_perf",
    "Game tick timings over the last N ticks: average/max tick and drift, plus the 20 most expensive phases (e.g. area, npc_aggression, combat.process.can_attack). Always collected.",
    { ticks: z.number().int().min(1).max(300).default(60) },
    ({ ticks }) => {
      const summary = ServerPerf.getSummary(ticks);
      return {
        ...summary,
        avgTickMs: ms(summary.avgTickMs),
        maxTickMs: ms(summary.maxTickMs),
        avgDriftMs: ms(summary.avgDriftMs),
        maxDriftMs: ms(summary.maxDriftMs),
        topPhases: summary.topPhases.map((phase) => ({
          name: phase.name, totalMs: ms(phase.totalMs), avgMs: ms(phase.avgMs), maxMs: ms(phase.maxMs),
        })),
      };
    }
  );

  tool(
    "plugin_perf",
    "Per-plugin hook and area timings since the last reset, most expensive first. Only collected while profiling is on (it adds a little overhead): turn it on, let the server run, then read.",
    {
      profiling: z.enum(["on", "off"]).optional().describe("Start or stop collecting; omit to leave it as is"),
      reset: z.boolean().default(false).describe("Clear collected stats before reading"),
      limit: z.number().int().min(1).max(50).default(15),
    },
    ({ profiling, reset, limit }) => {
      if (profiling) PluginPerf.setEnabled(profiling === "on");
      if (reset) PluginPerf.reset();
      return {
        profiling: PluginPerf.isEnabled(),
        plugins: PluginPerf.snapshot(limit).map((row) => ({
          ...row,
          totalMs: ms(row.totalMs), avgMs: ms(row.avgMs), maxMs: ms(row.maxMs),
          topEventTotalMs: ms(row.topEventTotalMs), topEventAvgMs: ms(row.topEventAvgMs), topEventP95Ms: ms(row.topEventP95Ms),
        })),
      };
    }
  );
};
