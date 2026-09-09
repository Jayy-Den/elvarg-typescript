/**
 * Client-side equipment/combat property types for custom items.
 *
 * Historically these came from `server/src/data/items` in the old xRSPS
 * server, which was replaced by the Elvarg server (module no longer exists).
 * The custom-item builder only needs them as *type labels* — they carry no
 * runtime behavior — so they are declared here instead.
 */

/**
 * Where an item is worn, mirroring the server's equipment slots
 * (Elvarg `EquipmentType`, keyed by container slot index).
 */
export type EquipmentType =
    | "HEAD_SLOT"
    | "CAPE_SLOT"
    | "AMULET_SLOT"
    | "WEAPON_SLOT"
    | "BODY_SLOT"
    | "SHIELD_SLOT"
    | "LEG_SLOT"
    | "HANDS_SLOT"
    | "FEET_SLOT"
    | "RING_SLOT"
    | "AMMUNITION_SLOT"
    | "NONE";

/**
 * Combat style handled by a weapon's interface. Mirrors the Elvarg server's
 * `WeaponProfile`/`FightType` groupings.
 */
export type WeaponInterface =
    | "UNARMED"
    | "SWORD"
    | "LONGSWORD"
    | "SCIMITAR"
    | "DAGGER"
    | "MACE"
    | "WARHAMMER"
    | "BATTLEAXE"
    | "TWO_HANDED_SWORD"
    | "SPEAR"
    | "HALBERD"
    | "PICKAXE"
    | "AXE"
    | "WHIP"
    | "CLAWS"
    | "BOW"
    | "CROSSBOW"
    | "THROWN"
    | "CHINCHOMPA"
    | "STAFF"
    | "BLADED_STAFF"
    | "MAGIC"
    | "PICKAXE_SPECIAL"
    | "TENTACLE_WHIP"
    | "SALAMANDER";

/**
 * Combat stat bonuses, applied server-side (Elvarg `ItemDefinition.bonuses`).
 */
export type ItemBonuses = {
    /** Melee accuracy bonuses. */
    attackStab?: number;
    attackSlash?: number;
    attackCrush?: number;
    attackMagic?: number;
    attackRanged?: number;
    /** Melee/ranged defence bonuses. */
    defenceStab?: number;
    defenceSlash?: number;
    defenceCrush?: number;
    defenceMagic?: number;
    defenceRanged?: number;
    /** Strength bonuses. */
    attackStrength?: number;
    rangedStrength?: number;
    magicDamage?: number;
    /** Prayer bonus. */
    prayer?: number;
};

/**
 * Level requirements to wield an item (Elvarg `ItemDefinition.requirements`).
 */
export type ItemRequirements = {
    attack?: number;
    strength?: number;
    defence?: number;
    ranged?: number;
    prayer?: number;
    magic?: number;
    runecrafting?: number;
    hitpoints?: number;
    crafting?: number;
    mining?: number;
    smithing?: number;
    fishing?: number;
    cooking?: number;
    firemaking?: number;
    woodcutting?: number;
    agility?: number;
    herblore?: number;
    thieving?: number;
    fletching?: number;
    slayer?: number;
    farming?: number;
    construction?: number;
    hunter?: number;
    hunterC?: number;
    totalLevel?: number;
    combatLevel?: number;
};
