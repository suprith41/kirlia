import {
  AI_PATTERNS,
  EMOTIONAL_MANIPULATION_WORDS,
  RAGE_BAIT_PATTERNS,
  UNVERIFIED_CLAIM_INDICATORS,
} from "./patterns.js";

const TRUSTED_DOMAINS = new Set([
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "bloomberg.com",
  "economist.com",
  "ft.com",
  "npr.org",
  "nytimes.com",
  "reuters.com",
  "theguardian.com",
  "washingtonpost.com",
  "wsj.com",
]);

const MISINFORMATION_DOMAINS = new Set([
  "beforeitsnews.com",
  "breitbart.com",
  "conservapedia.com",
  "dailycaller.com",
  "infowars.com",
  "naturalnews.com",
  "newsmax.com",
  "oneamerica.news",
  "prntly.com",
  "sputniknews.com",
  "thegatewaypundit.com",
  "zerohedge.com",
]);

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;
const WORD_REGEX = /\b[\p{L}\p{N}'-]+\b/gu;

/**
 * Analyze text for structural and statistical signals associated with
 * AI-generated writing.
 *
 * @param {string} text
 * @returns {{
 *   score: number,
 *   detectedPatterns: Array<{ type: string, match: string, count: number }>,
 *   metrics: {
 *     sentenceCount: number,
 *     wordCount: number,
 *     avgSentenceLength: number,
 *     vocabularyDiversity: number,
 *     repeatedSentenceStarterRatio: number,
 *     transitionDensity: number
 *   }
 * }}
 */
export function analyzeAIContent(text) {
  const normalizedText = normalizeText(text);
  const sentences = splitSentences(normalizedText);
  const words = tokenizeWords(normalizedText);
  const wordCount = words.length;
  const sentenceCount = sentences.length;
  const avgSentenceLength = sentenceCount ? wordCount / sentenceCount : 0;
  const vocabularyDiversity = calculateVocabularyDiversity(words);
  const repeatedStarters = getRepeatedSentenceStarters(sentences);
  const repeatedSentenceStarterRatio = sentenceCount
    ? repeatedStarters.totalRepeated / sentenceCount
    : 0;

  const aiPatternMatches = [
    ...collectPatternMatches(
      normalizedText,
      AI_PATTERNS.repetitiveSentenceStarters,
      "repetitive-sentence-starter",
    ),
    ...collectPatternMatches(
      normalizedText,
      AI_PATTERNS.transitionOveruse,
      "transition-overuse",
    ),
    ...collectPatternMatches(
      normalizedText,
      AI_PATTERNS.unnaturalPerfectGrammar,
      "overly-polished-phrase",
    ),
    ...collectPatternMatches(
      normalizedText,
      AI_PATTERNS.genericConclusions,
      "generic-conclusion",
    ),
    ...collectPatternMatches(
      normalizedText,
      AI_PATTERNS.repetitiveFraming,
      "repetitive-framing",
    ),
  ];

  const transitionCount = countMatches(
    normalizedText,
    AI_PATTERNS.transitionOveruse.flatMap((pattern) => [pattern]),
  );
  const transitionDensity = wordCount ? transitionCount / wordCount : 0;

  const scoreParts = [
    Math.min(aiPatternMatches.length * 7, 35),
    Math.min(repeatedSentenceStarterRatio * 120, 25),
    scoreSentenceLengthUniformity(sentences),
    scoreVocabularyDiversity(vocabularyDiversity),
    Math.min(transitionDensity * 600, 15),
  ];

  return {
    score: clampScore(scoreParts.reduce((sum, part) => sum + part, 0)),
    detectedPatterns: aiPatternMatches,
    metrics: {
      sentenceCount,
      wordCount,
      avgSentenceLength: round(avgSentenceLength),
      vocabularyDiversity: round(vocabularyDiversity, 3),
      repeatedSentenceStarterRatio: round(repeatedSentenceStarterRatio, 3),
      transitionDensity: round(transitionDensity, 3),
    },
  };
}

/**
 * Analyze text for rage-bait, emotionally manipulative wording, and sensational
 * language density.
 *
 * @param {string} text
 * @returns {{
 *   score: number,
 *   flaggedSentences: Array<{
 *     sentence: string,
 *     reasons: string[],
 *     emotionalWordHits: string[],
 *     rageBaitHits: string[],
 *     unverifiedClaimHits: string[]
 *   }>,
 *   metrics: {
 *     sentenceCount: number,
 *     emotionalWordCount: number,
 *     sensationalDensity: number,
 *     rageBaitMatchCount: number,
 *     unverifiedClaimCount: number
 *   }
 * }}
 */
export function analyzeManipulation(text) {
  const normalizedText = normalizeText(text);
  const sentences = splitSentences(normalizedText);
  const words = tokenizeWords(normalizedText);

  const emotionalWordSet = new Set(
    EMOTIONAL_MANIPULATION_WORDS.map((word) => word.toLowerCase()),
  );

  const flaggedSentences = sentences
    .map((sentence) => {
      const sentenceWords = tokenizeWords(sentence).map((word) => word.toLowerCase());
      const emotionalWordHits = sentenceWords.filter((word) => emotionalWordSet.has(word));
      const rageBaitHits = collectRegexHits(sentence, RAGE_BAIT_PATTERNS);
      const unverifiedClaimHits = collectRegexHits(sentence, UNVERIFIED_CLAIM_INDICATORS);
      const reasons = [
        ...(rageBaitHits.length ? ["Contains rage-bait or clickbait phrasing."] : []),
        ...(emotionalWordHits.length >= 2
          ? ["Uses a dense cluster of emotional trigger words."]
          : []),
        ...(unverifiedClaimHits.length ? ["Uses vague or weak attribution."] : []),
      ];

      return reasons.length
        ? {
            sentence,
            reasons,
            emotionalWordHits: unique(emotionalWordHits),
            rageBaitHits,
            unverifiedClaimHits,
          }
        : null;
    })
    .filter(Boolean);

  const emotionalWordCount = words.filter((word) =>
    emotionalWordSet.has(word.toLowerCase()),
  ).length;
  const rageBaitMatchCount = countMatches(normalizedText, RAGE_BAIT_PATTERNS);
  const unverifiedClaimCount = countMatches(normalizedText, UNVERIFIED_CLAIM_INDICATORS);
  const sensationalDensity = words.length
    ? (emotionalWordCount + rageBaitMatchCount * 3 + unverifiedClaimCount * 2) / words.length
    : 0;

  const scoreParts = [
    Math.min(rageBaitMatchCount * 14, 40),
    Math.min((emotionalWordCount / Math.max(words.length, 1)) * 900, 25),
    Math.min(unverifiedClaimCount * 9, 20),
    Math.min(flaggedSentences.length * 4, 15),
  ];

  return {
    score: clampScore(scoreParts.reduce((sum, part) => sum + part, 0)),
    flaggedSentences,
    metrics: {
      sentenceCount: sentences.length,
      emotionalWordCount,
      sensationalDensity: round(sensationalDensity, 3),
      rageBaitMatchCount,
      unverifiedClaimCount,
    },
  };
}

/**
 * Analyze a domain's reputation using built-in trusted and misinformation lists.
 * Lower scores indicate safer, more trustworthy domains; higher scores indicate
 * higher misinformation risk.
 *
 * @param {string} domain
 * @returns {{
 *   score: number,
 *   reputation: "trusted" | "unknown" | "high-risk",
 *   matchedDomain: string,
 *   reason: string
 * }}
 */
export function analyzeDomain(domain) {
  const normalizedDomain = normalizeDomain(domain);

  if (!normalizedDomain) {
    return {
      score: 50,
      reputation: "unknown",
      matchedDomain: "",
      reason: "No domain was provided for analysis.",
    };
  }

  const trustedMatch = findDomainMatch(normalizedDomain, TRUSTED_DOMAINS);
  if (trustedMatch) {
    return {
      score: 12,
      reputation: "trusted",
      matchedDomain: trustedMatch,
      reason: "Domain matches Kirlia's built-in trusted publisher list.",
    };
  }

  const riskMatch = findDomainMatch(normalizedDomain, MISINFORMATION_DOMAINS);
  if (riskMatch) {
    return {
      score: 88,
      reputation: "high-risk",
      matchedDomain: riskMatch,
      reason: "Domain matches a built-in high-risk misinformation list.",
    };
  }

  return {
    score: 50,
    reputation: "unknown",
    matchedDomain: normalizedDomain,
    reason: "Domain is not in the trusted or high-risk lists.",
  };
}

/**
 * Run the full Kirlia content analysis pipeline.
 *
 * @param {{
 *   text: string,
 *   domain?: string,
 *   url?: string,
 *   title?: string
 * }} pageData
 * @returns {{
 *   title: string,
 *   url: string,
 *   domain: string,
 *   status: string,
 *   scores: {
 *     ai: number,
 *     manipulation: number,
 *     trust: number
 *   },
 *   overallRisk: number,
 *   issues: string[],
 *   findings: {
 *     ai: ReturnType<typeof analyzeAIContent>,
 *     manipulation: ReturnType<typeof analyzeManipulation>,
 *     domain: ReturnType<typeof analyzeDomain>
 *   },
 *   flaggedSentences: Array<{
 *     sentence: string,
 *     reasons: string[]
 *   }>
 * }}
 */
export function runFullAnalysis(pageData) {
  const text = normalizeText(pageData?.text ?? "");
  const domain = pageData?.domain || extractDomain(pageData?.url ?? "");

  const ai = analyzeAIContent(text);
  const manipulation = analyzeManipulation(text);
  const domainAnalysis = analyzeDomain(domain);
  const overallRisk = clampScore(
    ai.score * 0.35 + manipulation.score * 0.4 + domainAnalysis.score * 0.25,
  );

  const issues = buildIssues(ai, manipulation, domainAnalysis);
  const flaggedSentences = manipulation.flaggedSentences.map(
    ({ sentence, reasons }) => ({ sentence, reasons }),
  );

  return {
    title: pageData?.title ?? "",
    url: pageData?.url ?? "",
    domain: normalizeDomain(domain),
    status: "ready",
    scores: {
      ai: ai.score,
      manipulation: manipulation.score,
      trust: domainAnalysis.score,
    },
    overallRisk,
    issues,
    findings: {
      ai,
      manipulation,
      domain: domainAnalysis,
    },
    flaggedSentences,
  };
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

function tokenizeWords(text) {
  return text.match(WORD_REGEX) ?? [];
}

function calculateVocabularyDiversity(words) {
  if (!words.length) {
    return 0;
  }

  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  return uniqueWords.size / words.length;
}

function getRepeatedSentenceStarters(sentences) {
  const starters = sentences
    .map((sentence) =>
      tokenizeWords(sentence)
        .slice(0, 3)
        .join(" ")
        .toLowerCase(),
    )
    .filter(Boolean);

  const counts = starters.reduce(
    (accumulator, starter) => ({
      ...accumulator,
      [starter]: (accumulator[starter] ?? 0) + 1,
    }),
    {},
  );

  const repeated = Object.entries(counts).filter(([, count]) => count > 1);
  return {
    repeated,
    totalRepeated: repeated.reduce((sum, [, count]) => sum + count, 0),
  };
}

function collectPatternMatches(text, patterns, type) {
  return patterns
    .map((pattern) => {
      const hits = collectRegexHits(text, [pattern]);
      return hits.length
        ? {
            type,
            match: hits[0],
            count: hits.length,
          }
        : null;
    })
    .filter(Boolean);
}

function collectRegexHits(text, patterns) {
  return patterns.flatMap((pattern) => {
    const regex = cloneRegex(pattern);
    return Array.from(text.matchAll(regex), (match) => match[0]);
  });
}

function countMatches(text, patterns) {
  return collectRegexHits(text, patterns).length;
}

function scoreSentenceLengthUniformity(sentences) {
  if (sentences.length < 3) {
    return 0;
  }

  const lengths = sentences.map((sentence) => tokenizeWords(sentence).length);
  const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  const variance =
    lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) / lengths.length;
  const standardDeviation = Math.sqrt(variance);
  const uniformityRatio = average ? standardDeviation / average : 0;

  return clampScore(Math.max(0, (0.32 - uniformityRatio) * 60));
}

function scoreVocabularyDiversity(diversity) {
  if (diversity === 0) {
    return 0;
  }

  if (diversity < 0.32) {
    return 25;
  }
  if (diversity < 0.42) {
    return 16;
  }
  if (diversity < 0.5) {
    return 8;
  }
  return 0;
}

function normalizeDomain(domain) {
  return String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function findDomainMatch(domain, domainSet) {
  return Array.from(domainSet).find(
    (candidate) => domain === candidate || domain.endsWith(`.${candidate}`),
  );
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function buildIssues(ai, manipulation, domainAnalysis) {
  return [
    ...(ai.detectedPatterns.length
      ? [
          `AI pattern indicators detected: ${ai.detectedPatterns
            .slice(0, 3)
            .map((pattern) => pattern.type)
            .join(", ")}.`,
        ]
      : []),
    ...(manipulation.flaggedSentences.length
      ? [
          `${manipulation.flaggedSentences.length} sentence(s) flagged for emotional or weakly sourced language.`,
        ]
      : []),
    ...(domainAnalysis.reputation === "trusted"
      ? ["Domain is on the built-in trusted publisher list."]
      : []),
    ...(domainAnalysis.reputation === "high-risk"
      ? ["Domain is on the built-in high-risk misinformation list."]
      : []),
    ...(domainAnalysis.reputation === "unknown"
      ? ["Domain reputation is unknown and should be treated cautiously."]
      : []),
  ];
}

function unique(values) {
  return [...new Set(values)];
}

function cloneRegex(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
