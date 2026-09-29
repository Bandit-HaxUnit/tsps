// Run after `yarn build`: node --test tests/skill-max-level.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const sender = new Proxy({}, { get: (_, name) => (name === "then" ? undefined : () => sender) });
const skills = new SkillManager({ getPacketSender: () => sender });

test("lowering a skill takes effect on the first call (issue #101)", () => {
  for (const level of [99, 1]) {
    skills
      .setCurrentLevels(Skill.ATTACK, level)
      .setMaxLevel(Skill.ATTACK, level)
      .setExperience(Skill.ATTACK, SkillManager.getExperienceForLevel(level));
    assert.equal(skills.getMaxLevel(Skill.ATTACK), level);
  }
});
