/**
 * Arabic haraqat (diacritic marks) + character classes.
 *
 * Direct port of `rababa/lib/rababa/arabic.rb` constants. These are
 * Unicode code-point references — kept exactly as the Ruby source
 * defines them so the encoder vocab matches the trained model.
 */

/** Single haraqat (basic diacritics). */
export const HARAQAT = [
  "ْ", "ّ", "ٌ", "ٍ", "ِ", "ً", "َ", "ُ",
] as const

/** Unicode escapes of HARAQAT for clarity. */
export const UHARAQAT = [
  "ْ", "ّ", "ٌ", "ٍ", "ِ", "ً", "َ", "ُ",
] as const

/** Punctuations allowed by the Arabic cleaner. */
export const PUNCTUATIONS = [".", "،", ":", "؛", "-", "؟"] as const

/** Arabic characters the model accepts (including space). */
export const ARAB_CHARS = "ىعظحرسيشضق ثلصطكآماإهزءأفؤغجئدةخوبذتن"

/** Arabic characters without the space. */
export const ARAB_CHARS_NO_SPACE =
  "ىعظحرسيشضقثلصطكآماإهزءأفؤغجئدةخوبذتن"

/** Valid Arabic characters for the cleaner's whitelist. */
export const VALID_ARABIC = [...HARAQAT, ...ARAB_CHARS]

/**
 * Map of basic haraqat → display name. Used for human-readable
 * diagnostics; the model uses indices into ALL_POSSIBLE_HARAQAT.
 */
export const BASIC_HARAQAT: Readonly<Record<string, string>> = Object.freeze({
  "َ": "Fatha",
  "ً": "Fathatah",
  "ُ": "Damma",
  "ٌ": "Dammatan",
  "ِ": "Kasra",
  "ٍ": "Kasratan",
  "ْ": "Sukun",
  "ّ": "Shaddah",
})

/**
 * Complete output vocabulary: every haraqat combination the model
 * can predict. Index into this dict = target token ID.
 *
 * Order matters — must match the model's training-time vocab order.
 */
export const ALL_POSSIBLE_HARAQAT: Readonly<Record<string, string>> = Object.freeze({
  "": "No Diacritic",
  "َ": "Fatha",
  "ً": "Fathatah",
  "ُ": "Damma",
  "ٌ": "Dammatan",
  "ِ": "Kasra",
  "ٍ": "Kasratan",
  "ْ": "Sukun",
  "ّ": "Shaddah",
  "َّ": "Shaddah + Fatha",
  "ًّ": "Shaddah + Fathatah",
  "ُّ": "Shaddah + Damma",
  "ٌّ": "Shaddah + Dammatan",
  "ِّ": "Shaddah + Kasra",
  "ٍّ": "Shaddah + Kasratan",
})

/**
 * Reverse lookup: haraqat string → index. Matches the encoder's
 * `@target_symbol_to_id`.
 */
export const HARAAQAT_TO_ID: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.keys(ALL_POSSIBLE_HARAQAT).map((k, i) => [k, i])),
)

/**
 * Reverse lookup: index → haraqat string. Matches the encoder's
 * `@target_id_to_symbol`.
 *
 * The model's target vocab is `[@pad] + ALL_POSSIBLE_HARAQAT.keys`,
 * so index 0 = pad ("P", treated as no-op) and indices 1..15 are
 * the haraqat combinations. The model output has 17 classes (extra
 * slot for start token "s" used during training); the last index
 * is unused at inference time and decodes to "".
 */
const TARGET_PAD_SYMBOL = "P"
export const ID_TO_HARAAQAT: readonly string[] = [
  TARGET_PAD_SYMBOL,
  ...Object.keys(ALL_POSSIBLE_HARAQAT),
  "",
]

/**
 * Input vocab used by BasicArabicEncoder. Index 0 = pad ("P");
 * remaining indices match the source's input_chars string.
 *
 * Direct port of `rababa/lib/rababa/arabic/encoders.rb:84`.
 */
export const INPUT_CHARS = "بض.غىهظخة؟:طس،؛فندؤلوئآك-يذاصشحزءمأجإ ترقعث"

export const PAD_SYMBOL = "P"
export const INPUT_VOCAB: readonly string[] = [PAD_SYMBOL, ...INPUT_CHARS]
export const INPUT_SYMBOL_TO_ID: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(INPUT_VOCAB.map((s, i) => [s, i])),
)
export const INPUT_ID_TO_SYMBOL: readonly string[] = INPUT_VOCAB
