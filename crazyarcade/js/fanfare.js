// The fanfare for a level up, or for a win that ends three losses in a row: the client's
// congratulation jingle.
import { sfx } from './audio.js';

export function fanfareSound() { sfx('Ntc_CoupleCongratulate', 0.9); }
