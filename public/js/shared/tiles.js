// Tile model shared by server and client.
// A physical tile is an id 0..135; its kind ("type") is id >> 2, 0..33:
//   0-8 man 1-9, 9-17 pin 1-9, 18-26 sou 1-9,
//   27-30 winds E S W N, 31-33 dragons haku hatsu chun.
// The first copy of each five (ids 16, 52, 88) is the red five (akadora).

export const AKA_IDS = [16, 52, 88];

// Physical wall model (public information only). Slots 0..121 are the live
// wall in draw order, 122..135 the dead wall; slot s sits in stack s >> 1
// (top tile = even slot) counted clockwise from the break. Dead-wall stack d
// (0..6, 6 is next to the break) holds slots 122 + 2d (top) and 123 + 2d.
// k.dead[0..3] are rinshan tiles, k.dead[4..8] dora indicators, k.dead[9..13] ura.
export const deadSlot = (i) => {
  if (i < 4) return 122 + 2 * (6 - (i >> 1)) + (i & 1);
  if (i < 9) return 122 + 2 * (4 - (i - 4));
  return 123 + 2 * (4 - (i - 9));
};


export const tileType = (id) => id >> 2;
export const isAka = (id) => id === 16 || id === 52 || id === 88;
export const isHonor = (t) => t >= 27;
export const isTerminal = (t) => t < 27 && (t % 9 === 0 || t % 9 === 8);
export const isYaochuu = (t) => t >= 27 || t % 9 === 0 || t % 9 === 8;
export const isWind = (t) => t >= 27 && t <= 30;
export const isDragon = (t) => t >= 31;
export const suitOf = (t) => (t < 27 ? Math.floor(t / 9) : 3);
export const numOf = (t) => (t < 27 ? (t % 9) + 1 : t - 26);

export const YAOCHUU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function doraFromIndicator(t) {
  if (t < 27) return t - (t % 9) + ((t % 9) + 1) % 9;
  if (t <= 30) return 27 + ((t - 27 + 1) % 4);
  return 31 + ((t - 31 + 1) % 3);
}

export function sortTiles(ids) {
  return [...ids].sort((a, b) => a - b);
}

export function counts34(ids) {
  const c = new Array(34).fill(0);
  for (const id of ids) c[id >> 2]++;
  return c;
}

const SUIT_LETTER = ['m', 'p', 's', 'z'];
export function typeCode(t) {
  return `${numOf(t)}${SUIT_LETTER[suitOf(t)]}`;
}

// "123m456p0s77z" -> tile types (0 means red five, mapped to type of 5).
export function parseTypes(str) {
  const out = [];
  let digits = [];
  for (const ch of str.replace(/\s+/g, '')) {
    if (/[0-9]/.test(ch)) digits.push(Number(ch));
    else {
      const s = SUIT_LETTER.indexOf(ch);
      if (s < 0) throw new Error(`bad tile string ${str}`);
      for (const d of digits) out.push(s * 9 + (d === 0 ? 5 : d) - 1);
      digits = [];
    }
  }
  return out;
}

// Same as parseTypes but returns concrete ids; "0" picks the red five.
export function parseIds(str, used = new Set()) {
  const out = [];
  let digits = [];
  for (const ch of str.replace(/\s+/g, '')) {
    if (/[0-9]/.test(ch)) digits.push(Number(ch));
    else {
      const s = SUIT_LETTER.indexOf(ch);
      for (const d of digits) {
        const t = s * 9 + (d === 0 ? 5 : d) - 1;
        let id = -1;
        for (let k = 0; k < 4; k++) {
          const cand = t * 4 + k;
          if (used.has(cand)) continue;
          if (d === 0 && !isAka(cand)) continue;
          if (d !== 0 && isAka(cand)) continue;
          id = cand;
          break;
        }
        if (id < 0) throw new Error(`no copy left for ${d}${ch}`);
        used.add(id);
        out.push(id);
      }
      digits = [];
    }
  }
  return out;
}

const HONOR_IMG = ['Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun'];
const SUIT_IMG = ['Man', 'Pin', 'Sou'];
// File base name following the FluffyStuff/riichi-mahjong-tiles convention.
export function imageName(id) {
  const t = tileType(id);
  if (t >= 27) return HONOR_IMG[t - 27];
  return `${SUIT_IMG[suitOf(t)]}${numOf(t)}${isAka(id) ? '-Dora' : ''}`;
}

export const WIND_KANJI = ['東', '南', '西', '北'];
export const HONOR_KANJI = ['東', '南', '西', '北', '白', '發', '中'];
export const SUIT_KANJI = ['萬', '筒', '索'];

export const YAKU_NAMES = {
  riichi: ['立直', 'Riichi'],
  doubleRiichi: ['両立直', 'Double Riichi'],
  ippatsu: ['一発', 'Ippatsu'],
  tsumo: ['門前清自摸和', 'Menzen Tsumo'],
  pinfu: ['平和', 'Pinfu'],
  tanyao: ['断幺九', 'Tanyao'],
  iipeikou: ['一盃口', 'Iipeikou'],
  haku: ['役牌 白', 'Haku'],
  hatsu: ['役牌 發', 'Hatsu'],
  chun: ['役牌 中', 'Chun'],
  seatWind: ['自風', 'Viento propio'],
  roundWind: ['場風', 'Viento de ronda'],
  haitei: ['海底摸月', 'Haitei'],
  houtei: ['河底撈魚', 'Houtei'],
  rinshan: ['嶺上開花', 'Rinshan Kaihou'],
  chankan: ['槍槓', 'Chankan'],
  chiitoitsu: ['七対子', 'Chiitoitsu'],
  chanta: ['混全帯幺九', 'Chanta'],
  ittsu: ['一気通貫', 'Ittsu'],
  sanshoku: ['三色同順', 'Sanshoku'],
  sanshokuDoukou: ['三色同刻', 'Sanshoku Doukou'],
  toitoi: ['対々和', 'Toitoi'],
  sanankou: ['三暗刻', 'Sanankou'],
  sankantsu: ['三槓子', 'Sankantsu'],
  shousangen: ['小三元', 'Shousangen'],
  honroutou: ['混老頭', 'Honroutou'],
  honitsu: ['混一色', 'Honitsu'],
  junchan: ['純全帯幺九', 'Junchan'],
  ryanpeikou: ['二盃口', 'Ryanpeikou'],
  chinitsu: ['清一色', 'Chinitsu'],
  dora: ['ドラ', 'Dora'],
  aka: ['赤ドラ', 'Aka dora'],
  ura: ['裏ドラ', 'Ura dora'],
  kokushi: ['国士無双', 'Kokushi Musou'],
  suuankou: ['四暗刻', 'Suuankou'],
  daisangen: ['大三元', 'Daisangen'],
  shousuushii: ['小四喜', 'Shousuushii'],
  daisuushii: ['大四喜', 'Daisuushii'],
  tsuuiisou: ['字一色', 'Tsuuiisou'],
  chinroutou: ['清老頭', 'Chinroutou'],
  ryuuiisou: ['緑一色', 'Ryuuiisou'],
  chuuren: ['九蓮宝燈', 'Chuuren Poutou'],
  suukantsu: ['四槓子', 'Suukantsu'],
  tenhou: ['天和', 'Tenhou'],
  chiihou: ['地和', 'Chiihou'],
};

export const DRAW_NAMES = {
  exhaustive: ['流局', 'Ryuukyoku (pared agotada)'],
  nagashi: ['流し満貫', 'Nagashi Mangan'],
  kyuushu: ['九種九牌', 'Kyuushu Kyuuhai'],
  suufon: ['四風連打', 'Suufon Renda'],
  suucha: ['四家立直', 'Suucha Riichi'],
  suukaikan: ['四開槓', 'Suukaikan'],
  sanchahou: ['三家和', 'Sanchahou'],
};
