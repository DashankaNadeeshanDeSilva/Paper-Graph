/**
 * Hardcoded English stopword list (~175 words).
 * No stemming — deterministic behavior as required by PRD 5.7.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
    'any', 'are', 'aren', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before',
    'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'couldn',
    'couldn\'t', 'd', 'did', 'didn', 'didn\'t', 'do', 'does', 'doesn', 'doesn\'t',
    'doing', 'don', 'don\'t', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'get', 'got', 'had', 'hadn', 'hadn\'t', 'has', 'hasn', 'hasn\'t',
    'have', 'haven', 'haven\'t', 'having', 'he', 'her', 'here', 'hers', 'herself',
    'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'isn\'t',
    'it', 'it\'s', 'its', 'itself', 'just', 'let', 'll', 'm', 'ma', 'may', 'me',
    'might', 'mightn', 'mightn\'t', 'more', 'most', 'much', 'must', 'mustn',
    'mustn\'t', 'my', 'myself', 'need', 'needn', 'needn\'t', 'no', 'nor', 'not',
    'now', 'o', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
    'ourselves', 'out', 'over', 'own', 'quite', 're', 's', 'said', 'same', 'shan',
    'shan\'t', 'she', 'she\'s', 'should', 'should\'ve', 'shouldn', 'shouldn\'t',
    'so', 'some', 'such', 't', 'than', 'that', 'that\'ll', 'the', 'their', 'theirs',
    'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
    'through', 'to', 'too', 'under', 'until', 'up', 'upon', 've', 'very', 'was',
    'wasn', 'wasn\'t', 'we', 'were', 'weren', 'weren\'t', 'what', 'when', 'where',
    'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'won', 'won\'t',
    'would', 'wouldn', 'wouldn\'t', 'y', 'you', 'you\'d', 'you\'ll', 'you\'re',
    'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
    // Additional academic/generic stopwords
    'also', 'based', 'et', 'al', 'using', 'via', 'vs', 'use', 'used', 'show',
    'shows', 'shown', 'propose', 'proposed', 'paper', 'approach', 'method',
    'results', 'model', 'models', 'work', 'study', 'new', 'novel', 'present',
    'presented', 'demonstrate', 'demonstrated', 'provide', 'provided',
    'however', 'therefore', 'thus', 'hence', 'although', 'moreover',
    'furthermore', 'additionally', 'specifically', 'respectively',
]);
