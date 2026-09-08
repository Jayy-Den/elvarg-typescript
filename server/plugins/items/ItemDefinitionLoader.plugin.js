const fs = require("fs");
const path = require("path");

function requireGameModule(modulePath) {
  const candidates = [
    path.resolve(process.cwd(), "src", "main", "typescript", "elvarg", modulePath),
    path.resolve(process.cwd(), "dist", modulePath),
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

const getGameConstants = () =>
  requireGameModule(path.join("game", "GameConstants")).GameConstants;
const getItemDefinition = () =>
  requireGameModule(path.join("game", "definition", "ItemDefinition"))
    .ItemDefinition;
const getEquipmentType = () =>
  requireGameModule(path.join("game", "model", "EquipmentType"))
    .EquipmentType;
const getWeaponInterfaces = () =>
  requireGameModule(path.join("game", "content", "combat", "WeaponInterfaces"))
    .WeaponInterfaces;
const getItemIdentifiers = () =>
  requireGameModule(path.join("util", "ItemIdentifiers")).ItemIdentifiers;

const AVERNIC_TREADS_BONUSES = [
  5, 5, 5, 11, 15,
  21, 25, 25, 10, 10,
  4, 2, 1, 0,
];
const AVERNIC_TREADS_REQUIREMENTS = [0, 80, 80, 0, 80, 0, 80];
const PEGASIAN_BOOTS_REQUIREMENTS = [0, 75, 0, 0, 75];
const ANCESTRAL_ROBES_REQUIREMENTS = [0, 65, 0, 0, 0, 0, 75];
const AHRIMS_STAFF_REQUIREMENTS = [70, 0, 0, 0, 0, 0, 70];
const TORAGS_HAMMERS_REQUIREMENTS = [70, 0, 70];
const BARROWS_BASE_ITEMS = [
  4708, 4710, 4712, 4714, 4716, 4718, 4720, 4722,
  4724, 4726, 4728, 4730, 4732, 4734, 4736, 4738,
  4745, 4747, 4749, 4751, 4753, 4755, 4757, 4759,
];
const AHRIMS_ARMOUR = new Set([4708, 4712, 4714]);

function hydrateEquipmentType(raw) {
  const EquipmentType = getEquipmentType();
  if (raw && typeof raw.getSlot === "function") {
    return raw;
  }
  if (typeof raw === "string" && EquipmentType[raw] != null) {
    return EquipmentType[raw];
  }
  return EquipmentType.NONE;
}

function hydrateWeaponInterface(raw) {
  if (raw == null) {
    return null;
  }
  if (raw && typeof raw.getInterfaceId === "function") {
    return raw;
  }
  const WeaponInterfaces = getWeaponInterfaces();
  if (typeof raw === "string") {
    return WeaponInterfaces?.[raw] ?? null;
  }
  return null;
}

function getItemDefinitionsPath() {
  const GameConstants = getGameConstants();
  return path.resolve(
    process.cwd(),
    GameConstants.DEFINITIONS_DIRECTORY,
    "item-gameplay.json"
  );
}

function loadItemDefinitions() {
  const ItemDefinition = getItemDefinition();
  const filePath = getItemDefinitionsPath();
  const content = fs.readFileSync(filePath, "utf8");
  const rawDefs = JSON.parse(content);
  const defs = Array.isArray(rawDefs) ? rawDefs : Object.values(rawDefs);

  ItemDefinition.definitions.clear();

  let loaded = 0;
  let unresolvedWeaponInterfaces = 0;
  let mismatched = 0;
  for (const rawDef of defs) {
    if (!rawDef || typeof rawDef !== "object") {
      continue;
    }

    const id = rawDef.id;
    if (!Number.isInteger(id) || id < 0) {
      continue;
    }
    const def = ItemDefinition.forId(id);
    if ((rawDef.name || "").trim().toLowerCase() !== def.getName().trim().toLowerCase()) {
      mismatched++;
      continue;
    }
    def.equipmentType = hydrateEquipmentType(rawDef.equipmentType);
    def.weaponInterface = hydrateWeaponInterface(rawDef.weaponInterface);
    for (const property of [
      "doubleHanded", "sellable", "bloodMoneyValue", "highAlch",
      "lowAlch", "dropValue", "blockAnim", "standAnim", "walkAnim", "runAnim",
      "standTurnAnim", "turn180Anim", "turn90CWAnim", "turn90CCWAnim", "bonuses",
      "requirements",
    ]) {
      if (rawDef[property] !== undefined) def[property] = rawDef[property];
    }
    if (rawDef.weaponInterface != null && def.weaponInterface == null) {
      unresolvedWeaponInterfaces++;
    }

    loaded += 1;
  }

  const ItemIdentifiers = getItemIdentifiers();
  ItemDefinition.forId(ItemIdentifiers.AVERNIC_TREADS).bonuses = AVERNIC_TREADS_BONUSES;
  ItemDefinition.forId(ItemIdentifiers.AVERNIC_TREADS).requirements = AVERNIC_TREADS_REQUIREMENTS;
  ItemDefinition.forId(ItemIdentifiers.PEGASIAN_BOOTS).requirements = PEGASIAN_BOOTS_REQUIREMENTS;
  for (const id of [
    ItemIdentifiers.ANCESTRAL_HAT,
    ItemIdentifiers.ANCESTRAL_ROBE_TOP,
    ItemIdentifiers.ANCESTRAL_ROBE_BOTTOM,
  ]) {
    ItemDefinition.forId(id).requirements = ANCESTRAL_ROBES_REQUIREMENTS;
  }

  ItemDefinition.forId(ItemIdentifiers.AHRIMS_STAFF).requirements = AHRIMS_STAFF_REQUIREMENTS;
  ItemDefinition.forId(ItemIdentifiers.TORAGS_HAMMERS).requirements = TORAGS_HAMMERS_REQUIREMENTS;
  for (const baseId of BARROWS_BASE_ITEMS) {
    const base = ItemDefinition.forId(baseId);
    if (AHRIMS_ARMOUR.has(baseId)) {
      base.bonuses = [...base.bonuses];
      base.bonuses[12] = 1;
    }
    const index = BARROWS_BASE_ITEMS.indexOf(baseId);
    for (let stage = 0; stage < 5; stage++) {
      const variant = ItemDefinition.forId(4856 + index * 6 + stage);
      variant.equipmentType = base.equipmentType;
      variant.weaponInterface = base.weaponInterface;
      variant.doubleHanded = base.doubleHanded;
      variant.requirements = [...base.requirements];
      variant.bonuses = stage === 4 ? new Array(14).fill(0) : [...base.bonuses];
    }
  }

  return {
    filePath,
    loaded,
    total: ItemDefinition.definitions.size,
    unresolvedWeaponInterfaces,
    mismatched,
  };
}

module.exports = {
  name: "ItemDefinitionLoader",
  register(api) {
    const startedAt = Date.now();
    const result = loadItemDefinitions();
    api.log("loaded", {
      file: path.relative(process.cwd(), result.filePath),
      loaded: result.loaded,
      total: result.total,
      unresolvedWeaponInterfaces: result.unresolvedWeaponInterfaces,
      mismatched: result.mismatched,
      elapsedMs: Date.now() - startedAt,
    });
  },
};
