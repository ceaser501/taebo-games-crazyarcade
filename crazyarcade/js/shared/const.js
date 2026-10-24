// Numbers and tables shared by the browser and the room server.

export const COLS = 15;
export const ROWS = 13;
export const TILE = 40;
export const HZ = 30; // simulation ticks per second, on both sides
export const MAX_PLAYERS = 8;

export const ROUND_SECONDS = 180;
export const HURRY_SECONDS = 60; // "Hurry up!" when this much is left
// Timings follow measurements of the original client where there are any (boom-rs RULES_V1):
// a stream lasts about 540 ms, a bubble bursts about 6.35 s after it closes. The fuse time
// was never measured; 2.5 s is the usual remake value.
export const FUSE = Math.round(2.5 * HZ); // a water balloon pops this long after it is placed
export const FLAME = Math.ceil(0.54 * HZ); // a water stream stays this long
export const TRAP = Math.ceil(6.35 * HZ); // stuck in a bubble this long, then it bursts
export const START_DELAY = Math.round(2.4 * HZ); // the "START" spin before anyone can move
export const END_DELAY = Math.round(4 * HZ); // results stay up this long

// Movement speed for a speed level: the client moves 5 px per 30 ms step at level 5 and one
// pixel more per level (measured 165-170 px/s before a roller, 198-204 after).
export const speedPx = (s) => (s * 100) / 3;
export const TRAPPED_PX = 17; // a bubble drifts this fast (measured 16.3-17.0 px/s)

// Characters: id is the sprite prefix in FxCharacter (C00…C29); stats are [start, max] for
// balloons, stream length and speed, from the client's Attr/BomberAttr. `sel` is the number of
// the selection banner CharacterSelect/S_ChaNN (the table's own id for the first eight).
export const CHARACTERS = [
  { id: 'C00', sel: '00', name: '다오', bombs: [1, 10], power: [1, 7], speed: [5, 7] },
  { id: 'C01', sel: '01', name: '디지니', bombs: [2, 7], power: [1, 9], speed: [4, 8] },
  { id: 'C06', sel: '05', name: '배찌', bombs: [1, 6], power: [1, 7], speed: [5, 9] },
  { id: 'C04', sel: '04', name: '마리드', bombs: [2, 9], power: [1, 6], speed: [4, 8] },
  { id: 'C05', sel: '03', name: '에띠', bombs: [1, 10], power: [1, 8], speed: [4, 8] },
  { id: 'C03', sel: '02', name: '모스', bombs: [1, 8], power: [1, 5], speed: [5, 8] },
  { id: 'C02', sel: '06', name: '우니', bombs: [1, 6], power: [2, 7], speed: [5, 8] },
  { id: 'C07', sel: '07', name: '케피', bombs: [1, 9], power: [2, 8], speed: [4, 8] },
  { id: 'C08', sel: '08', name: '수', bombs: [2, 9], power: [1, 7], speed: [6, 10] },
  { id: 'C09', sel: '09', name: '후우', bombs: [3, 9], power: [1, 7], speed: [5, 10] },
  { id: 'C23', sel: '23', name: '레이', bombs: [3, 10], power: [2, 10], speed: [4, 6] },
  { id: 'C26', sel: '26', name: '루시', bombs: [2, 9], power: [1, 7], speed: [6, 10] },
  { id: 'C13', sel: '13', name: '럭셔리다오', bombs: [2, 8], power: [1, 8], speed: [6, 10] },
  { id: 'C16', sel: '16', name: '럭셔리디지니', bombs: [2, 9], power: [2, 8], speed: [5, 9] },
  { id: 'C10', sel: '10', name: '럭셔리마리드', bombs: [2, 9], power: [1, 7], speed: [5, 9] },
  { id: 'C14', sel: '14', name: '럭셔리에띠', bombs: [3, 9], power: [3, 7], speed: [6, 9] },
  { id: 'C15', sel: '15', name: '럭셔리모스', bombs: [2, 9], power: [2, 8], speed: [5, 9] },
  { id: 'C11', sel: '11', name: '럭셔리케피', bombs: [2, 8], power: [1, 9], speed: [5, 9] },
  { id: 'C20', sel: '20', name: '슈퍼배찌', bombs: [2, 9], power: [1, 9], speed: [6, 8] },
  { id: 'C19', sel: '19', name: '슈퍼우니', bombs: [1, 9], power: [1, 8], speed: [7, 9] },
  { id: 'C18', sel: '18', name: '슈퍼수', bombs: [2, 9], power: [2, 8], speed: [6, 10] },
  { id: 'C24', sel: '24', name: '슈퍼후우', bombs: [1, 7], power: [1, 9], speed: [7, 10] },
  { id: 'C27', sel: '27', name: '슈퍼레이', bombs: [2, 9], power: [2, 8], speed: [6, 10] },
  { id: 'C28', sel: '28', name: '슈퍼루시', bombs: [2, 9], power: [2, 8], speed: [6, 10] },
  { id: 'C17', sel: '17', name: '슈퍼럭마', bombs: [3, 9], power: [1, 7], speed: [5, 10] },
  { id: 'C29', sel: '29', name: '슈퍼럭띠', bombs: [2, 10], power: [1, 7], speed: [7, 10] },
];
export const charById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
// Selection banner in CharacterSelect/ is S_Cha + the number.
export const banner = (id) => `CharacterSelect/S_Cha${charById(id).sel}`;

// Team colours in the order of Prepare/PRE_SelTeam-BasicNN; hue is what the red parts of a
// character are turned to.
export const TEAMS = [
  { name: '빨강', css: '#ff2a2a', hue: 0 },
  { name: '노랑', css: '#ffd400', hue: 50 },
  { name: '주황', css: '#ff8a00', hue: 28 },
  { name: '초록', css: '#4cc21a', hue: 105 },
  { name: '하늘', css: '#2fd6e6', hue: 185 },
  { name: '파랑', css: '#1d63ff', hue: 222 },
  { name: '보라', css: '#9a2aff', hue: 272 },
  { name: '분홍', css: '#ff2aa8', hue: 322 },
];

// Items: what lies on the floor after a block breaks. `active` ones go to the item box and are
// used with the item button (Ctrl on PC). `weight` is the client's Attr/ItemAttr weight; a map's
// own drop list (maps-data drops) overrides it for the items it names. Needle and shield only
// drop where a map lists them.
export const ITEMS = {
  bomb: { sprite: 'Item/Bomb', weight: 3650 },
  potion: { sprite: 'Item/Potion', weight: 2800 },
  skate: { sprite: 'Item/Skate', weight: 2000 },
  maxpower: { sprite: 'Item/MaxPower', weight: 150 },
  devil: { sprite: 'Item/RedDevil', weight: 0 },
  needle: { sprite: 'Item/Niddle', weight: 0, active: true },
  shield: { sprite: 'Item/Shield', weight: 0, active: true },
  turtle: { sprite: 'Item/Turtle0', weight: 400 },
  owl: { sprite: 'Item/Owl', weight: 350 },
};
// A breakable block hides an item this often (per mille; remake value, the original is unknown).
export const ITEM_CHANCE = 350;
export const SHIELD_TIME = Math.round(3 * HZ);
export const DEVIL_TIME = Math.round(10 * HZ);
