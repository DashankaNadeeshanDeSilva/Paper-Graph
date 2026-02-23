import type { Paper, Entity, PaperEntity } from '../types/index.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

/**
 * Entity type for extraction.
 */
export type EntityType = 'dataset' | 'method' | 'task' | 'metric';

/**
 * Built-in dictionaries for entity extraction.
 * These are common entities in NLP/ML/AI papers.
 * Each entry maps EntityType to an array of known entity names.
 */
const ENTITY_DICTIONARIES: Record<EntityType, string[]> = {
    dataset: [
        'ImageNet', 'CIFAR-10', 'CIFAR-100', 'MNIST', 'COCO', 'SQuAD', 'GLUE',
        'SuperGLUE', 'WikiText', 'Penn Treebank', 'LibriSpeech', 'CommonVoice',
        'VoxCeleb', 'LJSpeech', 'WMT', 'OpenWebText', 'The Pile', 'C4',
        'SNLI', 'MultiNLI', 'SST-2', 'CoNLL', 'OntoNotes', 'WSJ',
        'MS MARCO', 'Natural Questions', 'TriviaQA', 'HotpotQA',
        'LAMBADA', 'WinoGrande', 'ARC', 'HellaSwag', 'BoolQ',
        'Visual Genome', 'Flickr30k', 'VCTK', 'DNS Challenge',
        'AudioSet', 'ESC-50', 'UrbanSound8K', 'MUSDB18',
    ],
    method: [
        'Transformer', 'BERT', 'GPT', 'ResNet', 'LSTM', 'GRU', 'CNN', 'RNN',
        'Attention', 'Self-Attention', 'Cross-Attention', 'Multi-Head Attention',
        'GAN', 'VAE', 'Diffusion', 'U-Net', 'ViT', 'CLIP', 'DALL-E',
        'Whisper', 'WaveNet', 'WaveRNN', 'Tacotron', 'FastSpeech',
        'ELMo', 'XLNet', 'RoBERTa', 'ALBERT', 'DeBERTa', 'T5', 'BART',
        'LLaMA', 'Mistral', 'Gemini', 'Claude', 'PaLM', 'Falcon',
        'Adam', 'SGD', 'AdamW', 'LAMB', 'RAdam',
        'BatchNorm', 'LayerNorm', 'GroupNorm', 'RMSNorm',
        'Dropout', 'Label Smoothing', 'Mixup', 'CutMix',
        'Beam Search', 'Greedy Decoding', 'Nucleus Sampling',
        'LoRA', 'QLoRA', 'Prefix Tuning', 'Prompt Tuning',
        'RLHF', 'DPO', 'Constitutional AI',
        'PageRank', 'Louvain', 'Spectral Clustering', 'K-Means',
    ],
    task: [
        'Speech Recognition', 'ASR', 'Speech Enhancement', 'Speech Separation',
        'Speaker Verification', 'Speaker Diarization', 'TTS', 'Text-to-Speech',
        'Machine Translation', 'Summarization', 'Question Answering',
        'Named Entity Recognition', 'NER', 'Sentiment Analysis',
        'Text Classification', 'Token Classification', 'Relation Extraction',
        'Image Classification', 'Object Detection', 'Semantic Segmentation',
        'Image Generation', 'Super Resolution', 'Style Transfer',
        'Language Modeling', 'Masked Language Modeling', 'Causal Language Modeling',
        'Natural Language Inference', 'Textual Entailment',
        'Information Retrieval', 'Document Ranking',
        'Reinforcement Learning', 'Imitation Learning',
        'Few-Shot Learning', 'Zero-Shot Learning', 'Transfer Learning',
        'Continual Learning', 'Federated Learning', 'Active Learning',
        'Source Separation', 'Audio Classification', 'Sound Event Detection',
    ],
    metric: [
        'BLEU', 'ROUGE', 'METEOR', 'CIDEr', 'BERTScore', 'BLEURT',
        'F1', 'Precision', 'Recall', 'Accuracy', 'AUC', 'ROC',
        'PESQ', 'STOI', 'SI-SNR', 'SI-SDR', 'SDR', 'SNR',
        'WER', 'CER', 'PER', 'EER', 'minDCF',
        'mAP', 'IoU', 'SSIM', 'PSNR', 'FID', 'IS',
        'Perplexity', 'Cross-Entropy', 'KL Divergence',
        'MOS', 'DNSMOS', 'ViSQOL',
    ],
};

/**
 * Extract entities from paper title + abstract using dictionary and regex matching.
 *
 * @param paper - Paper to extract entities from
 * @returns Array of { entity, role } pairs
 */
export function extractEntities(paper: Paper): Array<{
    entity: Omit<Entity, 'entity_id'>;
    role: string;
}> {
    const text = `${paper.title} ${paper.abstract ?? ''}`;
    const results: Array<{ entity: Omit<Entity, 'entity_id'>; role: string }> = [];
    const seen = new Set<string>();

    for (const [type, dictionary] of Object.entries(ENTITY_DICTIONARIES) as Array<[EntityType, string[]]>) {
        for (const name of dictionary) {
            // Case-insensitive whole-word match
            const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedName}\\b`, 'i');

            if (regex.test(text)) {
                const key = `${type}:${name.toLowerCase()}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    results.push({
                        entity: {
                            type,
                            name,
                            aliases_json: '[]',
                        },
                        role: type === 'dataset' ? 'uses' : type === 'method' ? 'applies' : 'evaluates',
                    });
                }
            }
        }
    }

    return results;
}

/**
 * Extract entities from all papers and return them grouped for batch insertion.
 */
export function extractAllEntities(papers: Paper[]): {
    entities: Omit<Entity, 'entity_id'>[];
    paperLinks: Array<{ entityIndex: number; paperId: number; role: string }>;
} {
    const entityMap = new Map<string, { entity: Omit<Entity, 'entity_id'>; index: number }>();
    const entities: Omit<Entity, 'entity_id'>[] = [];
    const paperLinks: Array<{ entityIndex: number; paperId: number; role: string }> = [];

    for (const paper of papers) {
        if (paper.paper_id === undefined) continue;

        const extracted = extractEntities(paper);

        for (const { entity, role } of extracted) {
            const key = `${entity.type}:${entity.name.toLowerCase()}`;

            if (!entityMap.has(key)) {
                const index = entities.length;
                entities.push(entity);
                entityMap.set(key, { entity, index });
            }

            const { index } = entityMap.get(key)!;
            paperLinks.push({
                entityIndex: index,
                paperId: paper.paper_id,
                role,
            });
        }
    }

    logger.info(
        { uniqueEntities: entities.length, totalLinks: paperLinks.length, papers: papers.length },
        'Entity extraction complete'
    );

    return { entities, paperLinks };
}
