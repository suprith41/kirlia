import {
  AI_PATTERNS,
  EMOTIONAL_MANIPULATION_WORDS,
  RAGE_BAIT_PATTERNS,
  UNVERIFIED_CLAIM_INDICATORS,
} from "./patterns.js";
import { generateFingerprint } from "./fingerprint.js";

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

const CREDIBLE_SOURCE_DOMAINS = new Set([
  ...TRUSTED_DOMAINS,
  "arxiv.org",
  "census.gov",
  "cdc.gov",
  "congress.gov",
  "doi.org",
  "ed.gov",
  "europa.eu",
  "fda.gov",
  "federalreserve.gov",
  "gov.uk",
  "imf.org",
  "jstor.org",
  "nature.com",
  "nih.gov",
  "noaa.gov",
  "nsf.gov",
  "oecd.org",
  "ourworldindata.org",
  "pubmed.ncbi.nlm.nih.gov",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "thelancet.com",
  "un.org",
  "who.int",
  "worldbank.org",
]);

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;
const WORD_REGEX = /\b[\p{L}\p{N}'-]+\b/gu;
const CITATION_PATTERN_REGEX =
  /(?:\[\d+\]|\(\s*(?:source|via|according to|cite[d]?)\s*:\s*[^)]+\)|\baccording\s+to\s+[A-Z][\w .&-]{2,80}|\b(?:study|report|data|filing|paper|survey)\s+(?:from|by|published by)\s+[A-Z][\w .&-]{2,80})/gi;
const CLAIM_PATTERN_REGEX =
  /\b(?:study|report|data|research|survey|evidence|experts?|officials?|sources?|figures?|statistics?|percent|percentage|increased|decreased|rose|fell|found|shows?|reveals?|claims?|according)\b|(?:\d+(?:\.\d+)?\s?%|\$[\d,.]+|\b\d{4}\b)/i;

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
 * Score sentence-by-sentence emotional intensity on a 0-10 scale.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function analyzeEmotionTimeline(text) {
  const normalizedText = normalizeText(text);
  const sentences = splitSentences(normalizedText);
  const emotionalWordSet = new Set(
    EMOTIONAL_MANIPULATION_WORDS.map((word) => word.toLowerCase()),
  );

  return sentences.map((sentence) =>
    scoreSentenceEmotionIntensity(sentence, emotionalWordSet),
  );
}

/**
 * Analyze whether an article gives transparent sourcing for factual claims.
 *
 * @param {string} text
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{
 *   score: number,
 *   level: "low" | "partial" | "well-sourced",
 *   summary: string,
 *   citedSentences: string[],
 *   uncitedClaimSentences: string[],
 *   metrics: {
 *     sentenceCount: number,
 *     wordCount: number,
 *     citationPatternCount: number,
 *     externalLinkCount: number,
 *     credibleSourceCount: number,
 *     suspiciousLinkCount: number,
 *     uncitedClaimCount: number
 *   },
 *   links: Array<{ href: string, domain: string, text: string, credibility: string }>
 * }}
 */
export function analyzeCitations(text, html = "", pageUrl = "") {
  const normalizedText = normalizeText(text);
  const sentences = splitSentences(normalizedText);
  const words = tokenizeWords(normalizedText);
  const pageDomain = normalizeDomain(extractDomain(pageUrl));
  const links = extractLinks(html, pageDomain);
  const externalLinks = links.filter((link) => link.isExternal);
  const credibleLinks = externalLinks.filter((link) => link.credibility === "credible");
  const suspiciousLinks = externalLinks.filter((link) => link.credibility === "suspicious");
  const citationPatternMatches = collectRegexHits(normalizedText, [CITATION_PATTERN_REGEX]);
  const citedSentences = findCitedSentences(sentences, links);
  const uncitedClaimSentences = findUncitedClaimSentences(sentences, citedSentences);
  const expectedSources = Math.max(1, Math.ceil(words.length / 450));
  const linkCoverageScore = Math.min(externalLinks.length / expectedSources, 1) * 26;
  const citationPatternScore = Math.min(citationPatternMatches.length / expectedSources, 1) * 22;
  const credibleSourceScore = Math.min(credibleLinks.length / expectedSources, 1) * 24;
  const citedClaimScore = sentences.length
    ? Math.min(citedSentences.length / Math.max(uncitedClaimSentences.length + citedSentences.length, 1), 1) * 18
    : 0;
  const suspiciousPenalty = Math.min(suspiciousLinks.length * 8, 18);
  const uncitedPenalty = Math.min(uncitedClaimSentences.length * 2.5, 22);
  const score = clampScore(
    linkCoverageScore +
      citationPatternScore +
      credibleSourceScore +
      citedClaimScore +
      10 -
      suspiciousPenalty -
      uncitedPenalty,
  );

  return {
    score,
    level: getCitationLevel(score),
    summary: buildCitationSummary(externalLinks, suspiciousLinks, score),
    citedSentences,
    uncitedClaimSentences,
    metrics: {
      sentenceCount: sentences.length,
      wordCount: words.length,
      citationPatternCount: citationPatternMatches.length,
      externalLinkCount: externalLinks.length,
      credibleSourceCount: credibleLinks.length,
      suspiciousLinkCount: suspiciousLinks.length,
      uncitedClaimCount: uncitedClaimSentences.length,
    },
    links: externalLinks.map(({ href, domain, text: linkText, credibility }) => ({
      href,
      domain,
      text: linkText,
      credibility,
    })),
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
 *     trust: number,
 *     sourceTransparency: number
 *   },
 *   overallRisk: number,
 *   issues: string[],
 *   findings: {
 *     ai: ReturnType<typeof analyzeAIContent>,
 *     manipulation: ReturnType<typeof analyzeManipulation>,
 *     domain: ReturnType<typeof analyzeDomain>,
 *     citations: ReturnType<typeof analyzeCitations>
 *   },
 *   emotionTimeline: {
 *     scores: number[],
 *     sentences: string[],
 *     spikeIndexes: number[],
 *     hasManipulationPattern: boolean,
 *     summary: string
 *   },
 *   writingFingerprint: ReturnType<typeof generateFingerprint>,
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
  const citations = analyzeCitations(text, pageData?.html ?? "", pageData?.url ?? "");
  const emotionTimeline = buildEmotionTimeline(text);
  const writingFingerprint = generateFingerprint(pageData?.text ?? text);
  const overallRisk = clampScore(
    ai.score * 0.3 +
      manipulation.score * 0.34 +
      domainAnalysis.score * 0.2 +
      (100 - citations.score) * 0.16,
  );

  const issues = buildIssues(ai, manipulation, domainAnalysis, emotionTimeline, citations);
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
      sourceTransparency: citations.score,
    },
    overallRisk,
    issues,
    findings: {
      ai,
      manipulation,
      domain: domainAnalysis,
      citations,
    },
    citationAnalysis: citations,
    emotionTimeline,
    writingFingerprint,
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

function extractLinks(html, pageDomain) {
  return Array.from(String(html ?? "").matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => {
      const href = decodeHtml(match[2]).trim();
      const linkText = stripHtml(match[3]).slice(0, 140);
      const domain = normalizeDomain(extractDomain(href));
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return null;
      }

      return {
        href,
        text: linkText,
        domain,
        isExternal: Boolean(domain && domain !== pageDomain),
        credibility: classifySourceDomain(domain),
      };
    })
    .filter(Boolean);
}

function classifySourceDomain(domain) {
  if (!domain) {
    return "unknown";
  }
  if (findDomainMatch(domain, CREDIBLE_SOURCE_DOMAINS) || domain.endsWith(".gov") || domain.endsWith(".edu")) {
    return "credible";
  }
  if (findDomainMatch(domain, MISINFORMATION_DOMAINS)) {
    return "suspicious";
  }
  return "unknown";
}

function findCitedSentences(sentences, links) {
  const citationRegex = cloneRegex(CITATION_PATTERN_REGEX);
  const linkTexts = links
    .map((link) => link.text)
    .filter((text) => text && tokenizeWords(text).length >= 2)
    .slice(0, 80);

  return sentences.filter((sentence) => {
    citationRegex.lastIndex = 0;
    if (citationRegex.test(sentence)) {
      return true;
    }

    const normalizedSentence = sentence.toLowerCase();
    return linkTexts.some((linkText) =>
      normalizedSentence.includes(linkText.toLowerCase().slice(0, 80)),
    );
  });
}

function findUncitedClaimSentences(sentences, citedSentences) {
  const citedSet = new Set(citedSentences);
  return sentences
    .filter((sentence) => sentence.length > 36)
    .filter((sentence) => CLAIM_PATTERN_REGEX.test(sentence) && !citedSet.has(sentence))
    .slice(0, 20);
}

function getCitationLevel(score) {
  if (score <= 33) {
    return "low";
  }
  if (score <= 66) {
    return "partial";
  }
  return "well-sourced";
}

function buildCitationSummary(externalLinks, suspiciousLinks, score) {
  const sourceLabel = `${externalLinks.length} external source${externalLinks.length === 1 ? "" : "s"}`;
  const suspiciousLabel = `${suspiciousLinks.length} suspicious link${suspiciousLinks.length === 1 ? "" : "s"}`;
  if (score <= 33) {
    return `${sourceLabel}, ${suspiciousLabel}. Low source transparency.`;
  }
  if (score <= 66) {
    return `${sourceLabel}, ${suspiciousLabel}. Some sources, but citation coverage is incomplete.`;
  }
  return `${sourceLabel}, ${suspiciousLabel}. Well-sourced article structure.`;
}

function stripHtml(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function buildEmotionTimeline(text) {
  const normalizedText = normalizeText(text);
  const sentences = splitSentences(normalizedText);
  const scores = analyzeEmotionTimeline(normalizedText);
  const spikeIndexes = findEmotionSpikes(scores);
  const hasRisingIntensity = detectRisingEmotionPattern(scores);
  const hasManipulationPattern =
    hasRisingIntensity || spikeIndexes.length >= 2 || scores.some((score) => score >= 8);

  return {
    scores,
    sentences,
    spikeIndexes,
    hasManipulationPattern,
    summary: buildEmotionTimelineSummary(scores, spikeIndexes, hasRisingIntensity),
  };
}

function scoreSentenceEmotionIntensity(sentence, emotionalWordSet) {
  const words = tokenizeWords(sentence);
  const lowerWords = words.map((word) => word.toLowerCase());
  const emotionalHits = lowerWords.filter((word) => emotionalWordSet.has(word)).length;
  const rageBaitHits = collectRegexHits(sentence, RAGE_BAIT_PATTERNS).length;
  const weakAttributionHits = collectRegexHits(sentence, UNVERIFIED_CLAIM_INDICATORS).length;
  const exclamationCount = (sentence.match(/!/g) ?? []).length;
  const questionExclamationCount = (sentence.match(/[!?]{2,}/g) ?? []).length;
  const uppercaseWords = words.filter(
    (word) => word.length > 2 && word === word.toUpperCase() && /[A-Z]/.test(word),
  ).length;
  const uppercaseRatio = words.length ? uppercaseWords / words.length : 0;
  const lengthPressure = words.length > 28 && emotionalHits ? 0.8 : 0;

  const score =
    emotionalHits * 1.15 +
    rageBaitHits * 2.4 +
    weakAttributionHits * 1.1 +
    Math.min(exclamationCount, 3) * 0.75 +
    questionExclamationCount * 0.85 +
    Math.min(uppercaseRatio * 9, 1.5) +
    lengthPressure;

  return clampEmotionScore(score);
}

function findEmotionSpikes(scores) {
  return scores.reduce((spikes, score, index) => {
    if (index === 0) {
      return spikes;
    }

    const previous = scores[index - 1];
    return score >= 6 && score - previous >= 3
      ? [...spikes, index]
      : spikes;
  }, []);
}

function detectRisingEmotionPattern(scores) {
  if (scores.length < 5) {
    return false;
  }

  const segmentSize = Math.max(2, Math.floor(scores.length / 3));
  const earlyAverage = average(scores.slice(0, segmentSize));
  const lateAverage = average(scores.slice(-segmentSize));
  const sustainedRiseCount = scores.filter(
    (score, index) => index > 0 && score - scores[index - 1] >= 1.5,
  ).length;

  return lateAverage - earlyAverage >= 2 || sustainedRiseCount >= 3;
}

function buildEmotionTimelineSummary(scores, spikeIndexes, hasRisingIntensity) {
  if (!scores.length) {
    return "Not enough article text to build an emotion timeline.";
  }

  const peak = Math.max(...scores);
  if (hasRisingIntensity) {
    return "Emotional intensity rises across the article, which can indicate persuasive escalation.";
  }
  if (spikeIndexes.length) {
    return `${spikeIndexes.length} sudden emotional spike(s) detected.`;
  }
  if (peak >= 8) {
    return "The article contains at least one highly intense sentence.";
  }
  return "Emotional intensity stays relatively steady across the article.";
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
    return new URL(String(url).startsWith("//") ? `https:${url}` : url).hostname;
  } catch {
    return "";
  }
}

function buildIssues(ai, manipulation, domainAnalysis, emotionTimeline, citations) {
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
    ...(emotionTimeline?.hasManipulationPattern
      ? [`Emotion timeline warning: ${emotionTimeline.summary}`]
      : []),
    ...(citations?.score <= 33
      ? ["Source transparency is low: claims are weakly cited or unsupported."]
      : []),
    ...(citations?.metrics?.suspiciousLinkCount
      ? [`Source transparency warning: ${citations.metrics.suspiciousLinkCount} suspicious source link(s) detected.`]
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

function clampEmotionScore(value) {
  return Math.max(0, Math.min(10, round(value, 1)));
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
