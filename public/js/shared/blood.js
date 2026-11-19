// Blood duel (an homage to the blood wager of Washizu mahjong): the points
// a duelist pays are drawn as blood. Shared by the engine and the client.

// cc of blood per 1000 points, per mode
export const BLOOD_RATES = { washizu: 10, akagi: 100 };
export const BLOOD_MODES = ['none', ...Object.keys(BLOOD_RATES)];
// over this many cc lost, a duelist dies
export const BLOOD_LIMIT = 2000;
// from this many cc lost (up to the limit, both included) a duelist tosses a coin
export const COIN_FROM = 1500;
// the uma of the manga (10-30); the oka of 20000 is the room's usual one
export const BLOOD_UMA = [30, 10, -10, -30];
// where the effects at the table change (cc lost): pale, hallucinations, heartbeat
export const BLOOD_STAGES = [500, 1000, COIN_FROM];
export const COIN_FACES = ['cara', 'sello'];

export const bloodRate = (mode) => BLOOD_RATES[mode] || 0;

// cc lost for a balance in points (what the duelist is down; ahead is 0)
export function ccLost(balance, rate) {
  return balance >= 0 ? 0 : Math.round((-balance * rate) / 1000);
}

// What a check finds after a payment: 'dead' over the limit; 'coin' in the
// coin zone when the duelist lost more blood than at the last check
// (entering the zone or bleeding inside it); otherwise null.
export function bloodFate(lost, before) {
  if (lost > BLOOD_LIMIT) return 'dead';
  if (lost >= COIN_FROM && lost > before) return 'coin';
  return null;
}

// 0: nothing; 1: pale (500); 2: hallucinations (1000); 3: the coin zone (1500)
export function bloodStage(lost) {
  return BLOOD_STAGES.filter((cc) => lost >= cc).length;
}
