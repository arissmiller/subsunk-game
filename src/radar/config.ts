import { spriteBoundingRadius } from "./spriteGeometry";
import { RADAR_WORLD_RADIUS_UNITS } from "../engine/navigation";
import type { ThrottleLevel } from "../radarTypes";

export const SONAR_WAVE_SPEED = 520;
export const SONAR_PULSE_INTERVAL_MS = 3000;
export const SONAR_PULSE_BAND_UNITS = 34;
export const SONAR_CONTACT_TRACK_MS = 4000;
export const DETECTION_PING_MS = 220;
export const CONTACT_VISIBLE_RADIUS = RADAR_WORLD_RADIUS_UNITS * 0.9;

export const VESSEL_COLLISION_RADIUS = spriteBoundingRadius("player");
export const MINE_COLLISION_RADIUS = spriteBoundingRadius("mine");
export const TORPEDO_COLLISION_RADIUS = 8;
export const VESSEL_MIN_TURN_RADIUS = 220;
export const COURSE_TURN_STEP = 0.2;
export const COURSE_TURN_LIMIT = 1;
export const COURSE_PREVIEW_DISTANCE = 720;
export const COURSE_PREVIEW_STEP_SECONDS = 0.35;
export const COURSE_PREVIEW_MIN_SPEED = 72;
export const THROTTLE_SPEEDS: Record<ThrottleLevel, number> = { 0: 0, 1: 85, 2: 180 };
export const VESSEL_ACCELERATION = 42;
export const VESSEL_DECELERATION = 30;

export const TORPEDO_MIN_TURN_RADIUS = 220;
export const TORPEDO_SPEED = THROTTLE_SPEEDS[2] * 2;
export const TORPEDO_FUSE_MS = 10000;
export const TORPEDO_TRAIL_LENGTH = 125;
export const TORPEDO_WIDTH_PX = 2;
export const TORPEDO_BAY_CAPACITY = 6;
export const TORPEDO_RELOAD_MS = 5000;

export const PLAYER_DETONATION_MS = 1400;
export const CONTACT_DETONATION_MS = 900;

export const ENEMY_HOLD_RANGE_MIN = 360;
export const ENEMY_HOLD_RANGE_MAX = 540;
export const ENEMY_MIN_FIRE_RANGE = 180;
export const ENEMY_MAX_FIRE_RANGE = 820;
export const ENEMY_BURST_SIZE = 3;
export const ENEMY_SHOT_INTERVAL_MS = 650;
export const ENEMY_BURST_COOLDOWN_MS = 3000;
export const ENEMY_TARGET_LEAD_SECONDS = TORPEDO_FUSE_MS / 1000;
export const ENEMY_SEPARATION_RADIUS = 180;
export const ENEMY_SEPARATION_MAX_BIAS_DEG = 20;
export const ENEMY_EVASION_CLEARANCE = 110;
export const ENEMY_EVASION_LOOKAHEAD_SECONDS = 6;

export const MINE_LAYER_SPEED = 58;
export const MINE_LAYER_LAY_INTERVAL_MS = 25000;
export const MINE_LAYER_LAY_VARIANCE_MS = 20000;
export const MINE_LAYER_GROUP_MIN = 3;
export const MINE_LAYER_GROUP_MAX = 6;
export const MINE_LAYER_SPREAD_RADIUS = 130;
export const MINE_LAYER_WANDER_MS = 10000;

export const ENEMY_MINE_LAYER_COUNT = 2;
export const ENEMY_MINE_LAYER_DISTANCE_MIN = 1400;
export const ENEMY_MINE_LAYER_DISTANCE_MAX = 2200;
export const ENEMY_RESPAWN_INTERVAL_MS = 24000;
export const ENEMY_ACTIVE_TARGET_MAX = 3;

export const CHUNK_SIZE = RADAR_WORLD_RADIUS_UNITS * 2;
export const CHUNK_LOAD_RADIUS = 2;
export const CHUNK_MINE_MIN = 3;
export const CHUNK_MINE_MAX = 6;
export const CHUNK_MINE_SPACING = 160;
export const CHUNK_PLAYER_SAFE_RADIUS = 250;
export const CHUNK_ENEMY_CHANCE = 0.1;

export const DEGREE_LABELS = [
  { angleDeg: 0, label: "000" },
  { angleDeg: 45, label: "045" },
  { angleDeg: 90, label: "090" },
  { angleDeg: 135, label: "135" },
  { angleDeg: 180, label: "180" },
  { angleDeg: 225, label: "225" },
  { angleDeg: 270, label: "270" },
  { angleDeg: 315, label: "315" },
] as const;

export const GRID_CELL_SIZE = 100;
export const GRID_COLOR = 0x74f0d2;
export const GRID_UNSCANNED_ALPHA = 0;
export const GRID_SCANNED_ALPHA = 0.14;
export const GRID_PING_ALPHA = 0.30;
export const GRID_HIGHLIGHT_MS = 800;

export const BOAT_SPEED = 110;
export const BOAT_ACCELERATION = 30;
export const BOAT_MIN_TURN_RADIUS = 220;
export const BOAT_HOLD_RANGE_MIN = 1100;
export const BOAT_HOLD_RANGE_MAX = 1500;
export const BOAT_MIN_FIRE_RANGE = 600;
export const BOAT_FIRE_RANGE = 1800;
export const BOAT_SONAR_RANGE = 2400;
export const BOAT_SONAR_INTERVAL_MS = 3000;
export const BOAT_TRACK_MAX_AGE_MS = 10000;
export const BOAT_SALVO_INTERVAL_MS = 6000;
export const BOAT_CHARGES_PER_SALVO = 5;
export const BOAT_COLLISION_RADIUS = spriteBoundingRadius("boat");
export const BOAT_BOUNDARY_MARGIN = 300;
export const BOAT_SPAWN_CHANCE = 0.03;
export const BOAT_RESPAWN_INTERVAL_MS = 24000;
export const BOAT_ACTIVE_MAX = 1;
export const DEPTH_CHARGE_SINK_MS = 3000;
export const DEPTH_CHARGE_BLAST_RADIUS = 70;

export const ENEMY_CURVE_PREDICTION_SECONDS = 6;
export const ENEMY_FIRE_TURN_MAX_SECONDS = 1.25;
export const ENEMY_FIRE_DETOUR_MAX_SECONDS = 2.5;
export const ENEMY_FIRE_RETURN_TOLERANCE_DEG = 5;
export const ENEMY_FIRE_MANEUVER_COOLDOWN_MS = 1000;

export const BOAT_MINE_INTERVAL_MS = 4000;
export const BOAT_MINE_SPACING = 180;

export const BOAT_SCATTER_RADIUS = 180;
