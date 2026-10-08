# Tumeken's shadow

`server/plugins/items/TumekensShadow.plugin.js`: its combat, its passive and its charges. It used to live in the Tombs of Amascut plugin, but it's a weapon used everywhere; the raid only answers whether the player is inside the tombs.

## Behaviour (Wiki)

- **Its definition** (`item-gameplay.json`): +35 magic attack, +20 magic defence and +1 prayer, two-handed, 85 Magic to wield. It uses the powered staff's styles (`POWERED_STAFF`, cache weapon category 24: Accurate, Accurate, Longrange).
- **It casts only its built-in spell:** max hit floor(Magic / 3) + 1, every 5 ticks, from 8 tiles (10 on Longrange), one charge a cast, with the usual damage-based Magic experience. The hit lands as the projectile arrives.
- **Its passive** multiplies the worn gear's magic attack and magic damage bonuses by 3, or by 4 inside the Tombs of Amascut. Magic damage is capped at 100%.
- **It can't be used against players.**
- **Charges:** two soul runes and five chaos runes a charge, up to 20,000. Using either rune on it adds as many charges as the inventory affords; Check shows them; Uncharge returns every rune. The last charge turns it into the uncharged staff.

## The cast

`TOA_SOT_CAST_B` (9493), with the graphics `TUMEKENS_SHADOW_CASTING` (2125) on the caster, `TUMEKENS_SHADOW_TRAVEL` (2126) as the projectile and `TUMEKENS_SHADOW_IMPACT` (2127) on the target.

## The tombs

The passive's ×4 needs to know whether the player is in the tombs, which is the raid's knowledge. The shadow emits `toa:in-tombs` with `{ player, inside: false }`; the Tombs of Amascut plugin (`Raid.TombsOfAmascut.js`) sets `inside` when the player is in the tombs region. Without that plugin it stays ×3.

## Simplifications

- It refuses every player target rather than only those outside minigames.
- Accurate's invisible +3 Magic isn't applied.
- No cast or impact sound.
