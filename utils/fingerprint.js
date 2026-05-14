const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;
const PARAGRAPH_SPLIT_REGEX = /\n{2,}/;
const WORD_REGEX = /\b[\p{L}\p{N}'-]+\b/gu;
const COMMON_PHRASE_REGEX = /\b[\p{L}\p{N}'-]+(?:\s+[\p{L}\p{N}'-]+){1,3}\b/gu;
const TRANSITION_WORDS = new Set([
  "additionally",
  "although",
  "consequently",
  "furthermore",
  "however",
  "meanwhile",
  "moreover",
  "nevertheless",
  "nonetheless",
  "overall",
  "therefore",
  "thus",
  "ultimately",
]);

/**
 * Create a compact writing-style signature for local similarity comparison.
 *
 * @param {string} text
 * @returns {{
 *   signature: string,
 *   metrics: {
 *     averageSentenceLength: number,
 *     vocabularyRichness: number,
 *     transitionFrequency: number,
 *     averageParagraphLength: number,
 *     paragraphLengthVariance: number,
 *     punctuation: Record<string, number>
 *   },
 *   commonPhrases: string[],
 *   vector: number[]
 * }}
 */
export function generateFingerprint(text) {
  const normalizedText = normalizeText(text);
  const sentences = splitSentences(normalizedText);
  const paragraphs = splitParagraphs(String(text ?? ""));
  const words = tokenizeWords(normalizedText);
  const totalWords = words.length;
  const sentenceLengths = sentences.map((sentence) => tokenizeWords(sentence).length);
  const paragraphLengths = paragraphs.map((paragraph) => tokenizeWords(paragraph).length);
  const punctuation = analyzePunctuation(normalizedText, totalWords);
  const transitionFrequency = calculateTransitionFrequency(words);
  const vocabularyRichness = totalWords
    ? new Set(words.map((word) => word.toLowerCase())).size / totalWords
    : 0;
  const commonPhrases = extractCommonPhrasePatterns(normalizedText);

  const metrics = {
    averageSentenceLength: round(average(sentenceLengths)),
    vocabularyRichness: round(vocabularyRichness, 3),
    transitionFrequency: round(transitionFrequency, 3),
    averageParagraphLength: round(average(paragraphLengths)),
    paragraphLengthVariance: round(coefficientOfVariation(paragraphLengths), 3),
    punctuation,
  };

  const vector = buildStyleVector(metrics);

  return {
    signature: buildSignature(vector, commonPhrases),
    metrics,
    commonPhrases,
    vector,
  };
}

/**
 * Compare two writing-style fingerprints and return a 0-100 similarity score.
 *
 * @param {ReturnType<typeof generateFingerprint>} fingerprint1
 * @param {ReturnType<typeof generateFingerprint>} fingerprint2
 * @returns {number}
 */
export function compareFingerprints(fingerprint1, fingerprint2) {
  if (!fingerprint1 || !fingerprint2) {
    return 0;
  }

  const vector1 = fingerprint1.vector ?? buildStyleVector(fingerprint1.metrics ?? {});
  const vector2 = fingerprint2.vector ?? buildStyleVector(fingerprint2.metrics ?? {});
  const vectorSimilarity = calculateVectorSimilarity(vector1, vector2);
  const phraseSimilarity = calculatePhraseSimilarity(
    fingerprint1.commonPhrases ?? [],
    fingerprint2.commonPhrases ?? [],
  );

  return Math.round(vectorSimilarity * 76 + phraseSimilarity * 24);
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
  return text
    ? text
        .split(SENTENCE_SPLIT_REGEX)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
    : [];
}

function splitParagraphs(text) {
  return text
    .split(PARAGRAPH_SPLIT_REGEX)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function tokenizeWords(text) {
  return text.match(WORD_REGEX) ?? [];
}

function analyzePunctuation(text, totalWords) {
  const denominator = Math.max(totalWords, 1);
  return {
    comma: round(countMatches(text, /,/g) / denominator, 3),
    semicolon: round(countMatches(text, /;/g) / denominator, 3),
    colon: round(countMatches(text, /:/g) / denominator, 3),
    dash: round(countMatches(text, /[-—]/g) / denominator, 3),
    quote: round(countMatches(text, /["'“”‘’]/g) / denominator, 3),
    question: round(countMatches(text, /\?/g) / denominator, 3),
    exclamation: round(countMatches(text, /!/g) / denominator, 3),
  };
}

function calculateTransitionFrequency(words) {
  if (!words.length) {
    return 0;
  }

  const transitionCount = words.filter((word) =>
    TRANSITION_WORDS.has(word.toLowerCase()),
  ).length;
  return transitionCount / words.length;
}

function extractCommonPhrasePatterns(text) {
  const phrases = Array.from(text.toLowerCase().matchAll(COMMON_PHRASE_REGEX), (match) =>
    match[0].trim(),
  ).filter((phrase) => phrase.length > 8);
  const counts = phrases.reduce((accumulator, phrase) => {
    accumulator[phrase] = (accumulator[phrase] ?? 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([phrase]) => phrase);
}

function buildStyleVector(metrics) {
  const punctuation = metrics.punctuation ?? {};
  return [
    normalizeFeature(metrics.averageSentenceLength ?? 0, 35),
    normalizeFeature(metrics.vocabularyRichness ?? 0, 1),
    normalizeFeature(metrics.transitionFrequency ?? 0, 0.08),
    normalizeFeature(metrics.averageParagraphLength ?? 0, 180),
    normalizeFeature(metrics.paragraphLengthVariance ?? 0, 1.5),
    normalizeFeature(punctuation.comma ?? 0, 0.14),
    normalizeFeature(punctuation.semicolon ?? 0, 0.025),
    normalizeFeature(punctuation.colon ?? 0, 0.035),
    normalizeFeature(punctuation.dash ?? 0, 0.045),
    normalizeFeature(punctuation.quote ?? 0, 0.1),
    normalizeFeature(punctuation.question ?? 0, 0.035),
    normalizeFeature(punctuation.exclamation ?? 0, 0.03),
  ];
}

function buildSignature(vector, commonPhrases) {
  const bucketedVector = vector.map((value) => Math.round(value * 20).toString(36));
  const phraseHash = hashString(commonPhrases.join("|")).toString(36);
  return `${bucketedVector.join("")}-${phraseHash}`;
}

function calculateVectorSimilarity(vector1, vector2) {
  const length = Math.max(vector1.length, vector2.length);
  if (!length) {
    return 0;
  }

  const distance = Array.from({ length }, (_, index) => {
    const diff = (vector1[index] ?? 0) - (vector2[index] ?? 0);
    return diff * diff;
  }).reduce((sum, value) => sum + value, 0);
  const normalizedDistance = Math.sqrt(distance / length);
  return Math.max(0, Math.min(1, 1 - normalizedDistance));
}

function calculatePhraseSimilarity(phrases1, phrases2) {
  if (!phrases1.length && !phrases2.length) {
    return 0.5;
  }

  const set1 = new Set(phrases1);
  const set2 = new Set(phrases2);
  const intersection = [...set1].filter((phrase) => set2.has(phrase)).length;
  const union = new Set([...set1, ...set2]).size;
  return union ? intersection / union : 0;
}

function normalizeFeature(value, max) {
  return Math.max(0, Math.min(1, Number(value) / max || 0));
}

function coefficientOfVariation(values) {
  const mean = average(values);
  if (!mean) {
    return 0;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function countMatches(text, regex) {
  return (text.match(regex) ?? []).length;
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
