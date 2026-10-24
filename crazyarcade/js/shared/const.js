// Numbers and tables shared by the browser and the room server.

export const COLS = 15;
export const ROWS = 13;
export const TILE = 40;
export const HZ = 30; // simulation ticks per second, on both sides
export const MAX_PLAYERS = 8;

export const ROUND_SECONDS = 180;
export const HURRY_SECONDS = 60; // "Hurry up!" when this much is left
export const FUSE = Math.round(2.8 * HZ); // a water balloon pops this long after it is placed
export const FLAME = Math.round(0.6 * HZ); // a water stream stays this long
export const TRAP = Math.round(4.2 * HZ); // stuck in a bubble this long, then it bursts
export const START_DELAY = Math.round(2.4 * HZ); // the "START" spin before anyone can move
export const END_DELAY = Math.round(4 * HZ); // results stay up this long

// Movement speed for a speed stat (pixels per second).
export const speedPx = (s) => 70 + s * 17;
export const TRAPPED_PX = 22;

// Characters: id is the sprite prefix in FxCharacter (C00…C29); stats are [start, max] for
// balloons, stream length and speed.
export const CHARACTERS = [
  { id: 'C00', name: '다오', bombs: [1, 10], power: [1, 7], speed: [5, 7] },
  { id: 'C01', name: '디지니', bombs: [2, 7], power: [1, 9], speed: [4, 8] },
  { id: 'C05', name: '배찌', bombs: [1, 6], power: [1, 7], speed: [5, 9] },
  { id: 'C04', name: '마리드', bombs: [2, 9], power: [1, 6], speed: [4, 8] },
  { id: 'C03', name: '에띠', bombs: [1, 10], power: [1, 7], speed: [4, 8] },
  { id: 'C02', name: '모스', bombs: [1, 8], power: [1, 5], speed: [5, 8] },
  { id: 'C06', name: '우니', bombs: [2, 9], power: [1, 7], speed: [4, 8] },
  { id: 'C07', name: '케피', bombs: [1, 9], power: [2, 8], speed: [4, 8] },
  { id: 'C08', name: '수', bombs: [2, 9], power: [1, 7], speed: [5, 8] },
  { id: 'C09', name: '후우', bombs: [2, 8], power: [1, 8], speed: [4, 9] },
  { id: 'C23', name: '레이', bombs: [2, 9], power: [1, 8], speed: [5, 8] },
  { id: 'C26', name: '루시', bombs: [2, 9], power: [1, 8], speed: [5, 8] },
  { id: 'C13', name: '럭셔리다오', bombs: [1, 10], power: [1, 8], speed: [5, 8] },
  { id: 'C16', name: '럭셔리디지니', bombs: [2, 8], power: [1, 9], speed: [4, 9] },
  { id: 'C10', name: '럭셔리마리드', bombs: [2, 10], power: [1, 7], speed: [4, 8] },
  { id: 'C14', name: '럭셔리에띠', bombs: [1, 10], power: [1, 8], speed: [4, 9] },
  { id: 'C15', name: '럭셔리모스', bombs: [1, 9], power: [1, 6], speed: [5, 9] },
  { id: 'C11', name: '럭셔리케피', bombs: [1, 10], power: [2, 8], speed: [4, 9] },
  { id: 'C20', name: '슈퍼배찌', bombs: [1, 7], power: [1, 8], speed: [5, 10] },
  { id: 'C19', name: '슈퍼우니', bombs: [2, 10], power: [1, 8], speed: [4, 9] },
  { id: 'C18', name: '슈퍼수', bombs: [2, 10], power: [1, 8], speed: [5, 9] },
  { id: 'C24', name: '슈퍼후우', bombs: [2, 9], power: [1, 9], speed: [4, 10] },
  { id: 'C27', name: '슈퍼레이', bombs: [2, 10], power: [1, 9], speed: [5, 9] },
  { id: 'C28', name: '슈퍼루시', bombs: [2, 10], power: [1, 9], speed: [5, 9] },
  { id: 'C17', name: '슈퍼럭마', bombs: [2, 10], power: [1, 8], speed: [4, 9] },
  { id: 'C29', name: '슈퍼럭띠', bombs: [1, 10], power: [1, 9], speed: [4, 9] },
];
export const charById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
// Selection banner in CharacterSelect/ is S_Cha + the number.
export const banner = (id) => `CharacterSelect/S_Cha${id.slice(1)}`;

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
// used with the item button (Ctrl on PC).
export const ITEMS = {
  bomb: { sprite: 'Item/Bomb', weight: 22 },
  potion: { sprite: 'Item/Potion', weight: 20 },
  skate: { sprite: 'Item/Skate', weight: 15 },
  maxpower: { sprite: 'Item/MaxPower', weight: 3 },
  devil: { sprite: 'Item/RedDevil', weight: 3 },
  needle: { sprite: 'Item/Niddle', weight: 6, active: true },
  shield: { sprite: 'Item/Shield', weight: 3, active: true },
  turtle: { sprite: 'Item/Turtle0', weight: 4 },
  owl: { sprite: 'Item/Owl', weight: 2 },
};
export const NO_ITEM_WEIGHT = 22;
export const SHIELD_TIME = Math.round(3 * HZ);
export const DEVIL_TIME = Math.round(10 * HZ);
